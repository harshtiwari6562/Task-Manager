import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../server.js';
import { initDB } from '../db.js';
import pool from '../db.js';

describe('Phase 1 - Data API Upgrade (B1, B2) Test Suite', () => {
  let authToken = '';
  let userId = null;

  beforeAll(async () => {
    await initDB();

    // Clean up test user
    await pool.execute("DELETE FROM users WHERE email = 'phase1_sync_test@example.com'");

    const regRes = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Phase1 User',
        email: 'phase1_sync_test@example.com',
        password: 'Password12',
      });
    expect(regRes.status).toBe(201);
    authToken = regRes.body.token;
    userId = regRes.body.user.id;
  });

  afterAll(async () => {
    try {
      if (userId) {
        await pool.execute('DELETE FROM user_data_tombstones WHERE user_id = ?', [userId]);
        await pool.execute('DELETE FROM user_data WHERE user_id = ?', [userId]);
        await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
      }
    } catch {}
  });

  it('1. Fast health check responds without database check and /api/v1 alias works', async () => {
    const health = await request(app).get('/api/health');
    expect(health.status).toBe(200);
    expect(health.body.status).toBe('healthy');
    expect(health.body).toHaveProperty('uptime');

    const v1Health = await request(app).get('/api/v1/health');
    expect(v1Health.status).toBe(200);
    expect(v1Health.body.status).toBe('healthy');

    const dbHealth = await request(app).get('/api/health/db');
    expect(dbHealth.status).toBe(200);
    expect(dbHealth.body.database).toBe('connected');
  });

  it('2. Enforces Key Allow-List on PUT and allows no-op DELETE on unknown keys', async () => {
    // Disallowed key
    const badKeyRes = await request(app)
      .put('/api/data/unauthorized_random_key')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ value: 'hello' });
    expect(badKeyRes.status).toBe(400);
    expect(badKeyRes.body.code).toBe('forbidden_key');

    // Allowed phone key: user-settings
    const settingsRes = await request(app)
      .put('/api/data/user-settings')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ value: JSON.stringify({ theme: 'dark' }) });
    expect(settingsRes.status).toBe(200);
    expect(settingsRes.body.key).toBe('user-settings');

    // Allowed pattern keys: extra-tasks:YYYY-MM-DD and daily:YYYY-MM-DD
    const extraRes = await request(app)
      .put('/api/data/extra-tasks:2026-10-22')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ value: JSON.stringify([{ id: '1', title: 'Task' }]) });
    expect(extraRes.status).toBe(200);

    const dailyRes = await request(app)
      .put('/api/data/daily:2026-10-22')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ value: JSON.stringify({ '1': true }) });
    expect(dailyRes.status).toBe(200);

    // DELETE of an unknown/disallowed key returns 200 as a no-op
    const delUnknown = await request(app)
      .delete('/api/data/unknown-old-key-xyz')
      .set('Authorization', `Bearer ${authToken}`);
    expect(delUnknown.status).toBe(200);
    expect(delUnknown.body.deleted).toBe(true);
  });

  it('3. GET /api/data/:key returns updatedAt and handles ETag/304', async () => {
    const key = 'dashboard-prefs';
    const putRes = await request(app)
      .put(`/api/data/${key}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ value: JSON.stringify({ showStreak: true }) });
    expect(putRes.status).toBe(200);
    expect(putRes.body).toHaveProperty('updatedAt');

    const getRes = await request(app)
      .get(`/api/data/${key}`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body).toHaveProperty('updatedAt');
    expect(getRes.headers).toHaveProperty('etag');

    // 304 If-None-Match test
    const etag = getRes.headers.etag;
    const cachedRes = await request(app)
      .get(`/api/data/${key}`)
      .set('Authorization', `Bearer ${authToken}`)
      .set('If-None-Match', etag);
    expect(cachedRes.status).toBe(304);
  });

  it('4. PUT /api/data/:key conflict detection with baseUpdatedAt (409) vs last-write-wins', async () => {
    const key = 'planner_events';

    // 1. Initial write
    const write1 = await request(app)
      .put(`/api/data/${key}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ value: JSON.stringify([{ id: 'ev-1', title: 'Version 1' }]) });
    expect(write1.status).toBe(200);
    const time1 = write1.body.updatedAt;

    // Small delay to ensure second write has later timestamp in MySQL
    await new Promise((r) => setTimeout(r, 1100));

    // 2. Second write updates the server resource
    const write2 = await request(app)
      .put(`/api/data/${key}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ value: JSON.stringify([{ id: 'ev-1', title: 'Version 2' }]) });
    expect(write2.status).toBe(200);
    const time2 = write2.body.updatedAt;
    expect(new Date(time2).getTime()).toBeGreaterThan(new Date(time1).getTime());

    // 3. Client A attempts to update using outdated baseUpdatedAt (time1)
    const conflictRes = await request(app)
      .put(`/api/data/${key}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        value: JSON.stringify([{ id: 'ev-1', title: 'Stale Version from Client A' }]),
        baseUpdatedAt: time1,
      });
    expect(conflictRes.status).toBe(409);
    expect(conflictRes.body.code).toBe('conflict');
    expect(conflictRes.body.server).toHaveProperty('value');
    expect(conflictRes.body.server).toHaveProperty('updatedAt');

    // 4. Client without baseUpdatedAt still succeeds with last-write-wins
    const lwwRes = await request(app)
      .put(`/api/data/${key}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        value: JSON.stringify([{ id: 'ev-1', title: 'Last Write Wins' }]),
      });
    expect(lwwRes.status).toBe(200);
  });

  it('5. DELETE leaves a tombstone that is returned in GET /api/data/bulk', async () => {
    const key = 'skill-steps:test-skill';
    // Create key
    await request(app)
      .put(`/api/data/${key}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ value: JSON.stringify({ 'step-1': true }) });

    // Delete key
    const delRes = await request(app)
      .delete(`/api/data/${key}`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(delRes.status).toBe(200);

    // Call bulk sync
    const bulkRes = await request(app)
      .get('/api/data/bulk?prefix=skill-steps:')
      .set('Authorization', `Bearer ${authToken}`);
    expect(bulkRes.status).toBe(200);
    expect(bulkRes.body).toHaveProperty('items');
    expect(bulkRes.body).toHaveProperty('deleted');
    expect(bulkRes.body).toHaveProperty('serverTime');

    // Deleted list must contain the tombstone
    const deletedKeys = bulkRes.body.deleted.map((d) => d.key);
    expect(deletedKeys).toContain(key);

    // If key is recreated, tombstone must be removed
    await request(app)
      .put(`/api/data/${key}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ value: JSON.stringify({ 'step-1': true }) });

    const bulkAfter = await request(app)
      .get('/api/data/bulk?prefix=skill-steps:')
      .set('Authorization', `Bearer ${authToken}`);
    const activeKeys = bulkAfter.body.items.map((i) => i.key);
    const revivedDeleted = bulkAfter.body.deleted.map((d) => d.key);
    expect(activeKeys).toContain(key);
    expect(revivedDeleted).not.toContain(key);
  });

  it('6. POST /api/data/batch executes multiple ops atomically and enforces limits', async () => {
    // Batch with valid ops
    const batchRes = await request(app)
      .post('/api/data/batch')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        ops: [
          { op: 'set', key: 'schedule_templates_v2', value: JSON.stringify({ A: { days: [1] } }) },
          { op: 'set', key: 'user-skills', value: JSON.stringify([{ id: 'py', name: 'Python' }]) },
          { op: 'delete', key: 'dashboard-prefs' },
        ],
      });
    expect(batchRes.status).toBe(200);
    expect(batchRes.body.ok).toBe(true);
    expect(batchRes.body.results).toHaveLength(3);

    // Batch exceeding 50 ops rejected with 400
    const oversizedOps = [];
    for (let i = 0; i < 55; i++) {
      oversizedOps.push({ op: 'set', key: `skill-steps:dummy-${i}`, value: '{}' });
    }
    const overRes = await request(app)
      .post('/api/data/batch')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ ops: oversizedOps });
    expect(overRes.status).toBe(400);

    // Batch with conflict on an op rolls back the whole batch
    const tplDoc = await request(app)
      .get('/api/data/schedule_templates_v2')
      .set('Authorization', `Bearer ${authToken}`);
    const currentTplUpdatedAt = tplDoc.body.updatedAt;

    // Outdated baseUpdatedAt
    const staleTime = new Date(Date.now() - 100000).toISOString();

    const conflictBatch = await request(app)
      .post('/api/data/batch')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        ops: [
          { op: 'set', key: 'schedule_templates_v2', value: '{"A":{}}', baseUpdatedAt: staleTime },
        ],
      });
    expect(conflictBatch.status).toBe(409);
    expect(conflictBatch.body.code).toBe('conflict');
  });

  it('7. /api/v1/data works identically as an alias', async () => {
    const v1Res = await request(app)
      .get('/api/v1/data')
      .set('Authorization', `Bearer ${authToken}`);
    expect(v1Res.status).toBe(200);
    expect(v1Res.body).toHaveProperty('keys');
  });
});
