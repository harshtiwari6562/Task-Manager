import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../server.js';
import { initDB } from '../db.js';
import pool from '../db.js';

describe('Phase 2 - Atomic Item Endpoints (B3) Test Suite', () => {
  let authToken = '';
  let userId = null;

  beforeAll(async () => {
    await initDB();

    // Clean up test user
    await pool.execute("DELETE FROM users WHERE email = 'phase2_atomic_test@example.com'");

    const regRes = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Phase2 User',
        email: 'phase2_atomic_test@example.com',
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

  it('1. PUT /api/planner/events/:id upserts event with custom fields and new mode/leadMinutes', async () => {
    const eventId = 'client-ev-1';
    const putRes = await request(app)
      .put(`/api/planner/events/${eventId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        dateKey: '2026-10-25',
        title: 'Deep Focus Morning Coding',
        time: '08:30 AM',
        category: 'Development',
        done: false,
        enableNotification: true,
        mode: 'alarm',
        leadMinutes: 10,
        customDeviceNote: 'Do not disturb phone', // unknown field preserved
      });

    expect(putRes.status).toBe(200);
    expect(putRes.body.ok).toBe(true);
    expect(putRes.body).toHaveProperty('updatedAt');
    expect(putRes.body.item.id).toBe(eventId);
    expect(putRes.body.item.mode).toBe('alarm');
    expect(putRes.body.item.leadMinutes).toBe(10);
    expect(putRes.body.item.customDeviceNote).toBe('Do not disturb phone');

    // Verify GET /api/planner/events returns this event
    const getRes = await request(app)
      .get('/api/planner/events?from=2026-10-24&to=2026-10-26')
      .set('Authorization', `Bearer ${authToken}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.events).toHaveLength(1);
    expect(getRes.body.events[0].id).toBe(eventId);
    expect(getRes.body.events[0].customDeviceNote).toBe('Do not disturb phone');
  });

  it('2. PATCH /api/planner/events/:id updates item partially and DELETE removes it', async () => {
    const eventId = 'client-ev-1';

    // PATCH done status
    const patchRes = await request(app)
      .patch(`/api/planner/events/${eventId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ done: true });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.ok).toBe(true);
    expect(patchRes.body.item.done).toBe(true);
    expect(patchRes.body.item.title).toBe('Deep Focus Morning Coding');

    // DELETE event
    const delRes = await request(app)
      .delete(`/api/planner/events/${eventId}`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(delRes.status).toBe(200);
    expect(delRes.body.ok).toBe(true);

    // Verify event is gone
    const getRes = await request(app)
      .get('/api/planner/events')
      .set('Authorization', `Bearer ${authToken}`);
    expect(getRes.body.events.find((e) => e.id === eventId)).toBeUndefined();
  });

  it('3. Parallel PATCH calls on different events inside same blob lose nothing', async () => {
    // 1. Create two events in planner_events
    await request(app)
      .put('/api/planner/events/ev-parallel-1')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        dateKey: '2026-10-26',
        title: 'Event One Original',
        time: '09:00 AM',
      });

    await request(app)
      .put('/api/planner/events/ev-parallel-2')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        dateKey: '2026-10-26',
        title: 'Event Two Original',
        time: '11:00 AM',
      });

    // 2. Fire simultaneous PATCH calls on ev-parallel-1 and ev-parallel-2
    const [res1, res2] = await Promise.all([
      request(app)
        .patch('/api/planner/events/ev-parallel-1')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ title: 'Event One Updated By Device A' }),
      request(app)
        .patch('/api/planner/events/ev-parallel-2')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ title: 'Event Two Updated By Device B' }),
    ]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    // 3. Inspect stored planner_events to confirm BOTH updates survived
    const getRes = await request(app)
      .get('/api/planner/events')
      .set('Authorization', `Bearer ${authToken}`);
    const e1 = getRes.body.events.find((e) => e.id === 'ev-parallel-1');
    const e2 = getRes.body.events.find((e) => e.id === 'ev-parallel-2');

    expect(e1).toBeDefined();
    expect(e1.title).toBe('Event One Updated By Device A');

    expect(e2).toBeDefined();
    expect(e2.title).toBe('Event Two Updated By Device B');
  });

  it('4. PUT & DELETE /api/extra-tasks/:dateKey/:id modifies daily extra task item', async () => {
    const dateKey = '2026-10-26';
    const taskId = 'extra-t1';

    // Add extra task
    const putRes = await request(app)
      .put(`/api/extra-tasks/${dateKey}/${taskId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        title: 'Review System Design PDF',
        skill: 'architecture',
        duration: '45 min',
      });

    expect(putRes.status).toBe(200);
    expect(putRes.body.ok).toBe(true);
    expect(putRes.body.item.id).toBe(taskId);
    expect(putRes.body.item.title).toBe('Review System Design PDF');
    expect(putRes.body.item.time).toBe('Extra Task');

    // Read raw blob to verify storage
    const rawData = await request(app)
      .get(`/api/data/extra-tasks:${dateKey}`)
      .set('Authorization', `Bearer ${authToken}`);
    const parsed = JSON.parse(rawData.body.value);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe(taskId);

    // Delete extra task
    const delRes = await request(app)
      .delete(`/api/extra-tasks/${dateKey}/${taskId}`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(delRes.status).toBe(200);

    const rawAfter = await request(app)
      .get(`/api/data/extra-tasks:${dateKey}`)
      .set('Authorization', `Bearer ${authToken}`);
    const parsedAfter = JSON.parse(rawAfter.body.value);
    expect(parsedAfter).toHaveLength(0);
  });

  it('5. PUT /api/daily/:dateKey/:taskId toggles task completion per web contract', async () => {
    const dateKey = '2026-10-26';
    const taskId = 'template-task-42';

    // Mark task done
    const doneRes = await request(app)
      .put(`/api/daily/${dateKey}/${taskId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ done: true });
    expect(doneRes.status).toBe(200);
    expect(doneRes.body.ok).toBe(true);
    expect(doneRes.body.item).toEqual({ taskId, done: true });

    // Verify key present in daily blob
    let dailyRaw = await request(app)
      .get(`/api/data/daily:${dateKey}`)
      .set('Authorization', `Bearer ${authToken}`);
    let dailyMap = JSON.parse(dailyRaw.body.value);
    expect(dailyMap[taskId]).toBe(true);

    // Mark task undone (key removed from map)
    const undoneRes = await request(app)
      .put(`/api/daily/${dateKey}/${taskId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ done: false });
    expect(undoneRes.status).toBe(200);
    expect(undoneRes.body.item).toEqual({ taskId, done: false });

    dailyRaw = await request(app)
      .get(`/api/data/daily:${dateKey}`)
      .set('Authorization', `Bearer ${authToken}`);
    dailyMap = JSON.parse(dailyRaw.body.value);
    expect(dailyMap[taskId]).toBeUndefined();
  });

  it('6. PUT /api/skills/:skillId/steps/:stepId toggles step completion', async () => {
    const skillId = 'fullstack-ts';
    const stepId = 'step-express-rest';

    const stepRes = await request(app)
      .put(`/api/skills/${skillId}/steps/${stepId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ done: true });

    expect(stepRes.status).toBe(200);
    expect(stepRes.body.ok).toBe(true);
    expect(stepRes.body.item).toEqual({ skillId, stepId, done: true });

    // Verify raw blob
    const rawSteps = await request(app)
      .get(`/api/data/skill-steps:${skillId}`)
      .set('Authorization', `Bearer ${authToken}`);
    const stepsMap = JSON.parse(rawSteps.body.value);
    expect(stepsMap[stepId]).toBe(true);
  });

  it('7. /api/v1 aliases work identically for Phase 2 routes', async () => {
    const v1Res = await request(app)
      .get('/api/v1/planner/events')
      .set('Authorization', `Bearer ${authToken}`);
    expect(v1Res.status).toBe(200);
    expect(v1Res.body).toHaveProperty('events');
  });
});
