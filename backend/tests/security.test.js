import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../server.js';
import { initDB } from '../db.js';
import pool from '../db.js';
import config from '../config.js';
import User from '../models/User.js';
import { registerSchema } from '../middleware/validation.js';

describe('Traject Security Audit Test Suite', () => {
  let userAToken = '';
  let userAId = null;
  let userBToken = '';
  let userBId = null;

  beforeAll(async () => {
    // Initialize MySQL database connection & migrations
    await initDB();

    // Clean up test users if they exist
    await pool.execute("DELETE FROM users WHERE email IN ('test_usera@example.com', 'test_userb@example.com')");

    // 1. Register User A
    const resA = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'User Alpha',
        email: 'test_usera@example.com',
        password: 'Secret12!',
      });
    expect(resA.status).toBe(201);
    userAToken = resA.body.token;
    userAId = resA.body.user.id;

    // 2. Register User B
    const resB = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'User Beta',
        email: 'test_userb@example.com',
        password: 'Passwd99!',
      });
    expect(resB.status).toBe(201);
    userBToken = resB.body.token;
    userBId = resB.body.user.id;
  });

  afterAll(async () => {
    // Cleanup test users and connections
    try {
      if (userAId) await pool.execute('DELETE FROM users WHERE id = ?', [userAId]);
      if (userBId) await pool.execute('DELETE FROM users WHERE id = ?', [userBId]);
    } catch (e) {
      // ignore cleanup errors
    }
  });

  // TEST 1: No token gives 401 on /api/data and /api/ai
  it('1. Returns 401 when no token is provided to /api/data or /api/ai', async () => {
    const dataRes = await request(app).get('/api/data');
    expect(dataRes.status).toBe(401);
    expect(dataRes.body).toHaveProperty('error');

    const aiRes = await request(app)
      .post('/api/ai/generate-skill')
      .send({ prompt: 'Learn Python' });
    expect(aiRes.status).toBe(401);
    expect(aiRes.body).toHaveProperty('error');
  });

  // TEST 2: User A cannot read, write, list or delete User B's keys
  it("2. User A cannot read, write, list or delete User B's keys", async () => {
    const key = 'private-roadmap-data';
    const valueB = JSON.stringify({ secret: 'User B private content' });

    // User B sets a key
    const setRes = await request(app)
      .put(`/api/data/${key}`)
      .set('Authorization', `Bearer ${userBToken}`)
      .send({ value: valueB });
    expect(setRes.status).toBe(200);

    // User A attempts to read User B's key -> should return 404 for User A
    const getResA = await request(app)
      .get(`/api/data/${key}`)
      .set('Authorization', `Bearer ${userAToken}`);
    expect(getResA.status).toBe(404);

    // User A lists keys -> should not contain User B's key
    const listResA = await request(app)
      .get('/api/data')
      .set('Authorization', `Bearer ${userAToken}`);
    expect(listResA.status).toBe(200);
    expect(listResA.body.keys).not.toContain(key);

    // User A attempts to delete User B's key -> does not delete B's data
    await request(app)
      .delete(`/api/data/${key}`)
      .set('Authorization', `Bearer ${userAToken}`);

    // User B verifies key still exists and is untouched
    const getResB = await request(app)
      .get(`/api/data/${key}`)
      .set('Authorization', `Bearer ${userBToken}`);
    expect(getResB.status).toBe(200);
    expect(getResB.body.value).toBe(valueB);
  });

  // TEST 3: Login rate limit returns 429
  it('3. Login rate limiter triggers 429 after exceeding attempt limit', async () => {
    let got429 = false;
    for (let i = 0; i < 15; i++) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'wrong_brute_force_target@example.com',
          password: 'WrongPassword999!',
        });
      if (res.status === 429) {
        got429 = true;
        expect(res.body).toHaveProperty('error');
        break;
      }
    }
    expect(got429).toBe(true);
  });

  // TEST 4: Invalid email, short password, overly long password, and long name are rejected
  it('4. Rejects invalid email, short password (< 6), long password (> 10), and overly long name with status 400', async () => {
    // Via endpoint (verifies validation middleware responds with 400)
    const badEmail = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Valid Name',
        email: 'notanemail',
        password: 'Valid12!',
      });
    expect(badEmail.status).toBe(400);

    const shortPass = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Valid Name',
        email: 'valid_test_pass@example.com',
        password: '12345',
      });
    expect(shortPass.status).toBe(400);

    // Direct schema validation unit checks (avoids IP register rate limiter exhaustion)
    expect(registerSchema.safeParse({ name: 'A', email: 'a@b.com', password: '12345' }).success).toBe(false); // < 6
    expect(registerSchema.safeParse({ name: 'A', email: 'a@b.com', password: 'Toolongpassword123' }).success).toBe(false); // > 10
    expect(registerSchema.safeParse({ name: 'A', email: 'a@b.com', password: '123456' }).success).toBe(true); // 6 chars (min)
    expect(registerSchema.safeParse({ name: 'A', email: 'a@b.com', password: '1234567890' }).success).toBe(true); // 10 chars (max)
    expect(registerSchema.safeParse({ name: 'A'.repeat(65), email: 'a@b.com', password: '123456' }).success).toBe(false); // > 60 chars
  });

  // TEST 5: Quota limits return 413 / 429
  it('5. Quota limits: rejects values over 256 KB with 413, invalid keys with 400', async () => {
    // 300 KB payload (over 256 KB max)
    const oversizedValue = 'X'.repeat(300 * 1024);

    const oversizedRes = await request(app)
      .put('/api/data/large_key')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({ value: oversizedValue });
    // Expect 413 Payload Too Large (or 400 from parser limits)
    expect([413, 400]).toContain(oversizedRes.status);
    expect(oversizedRes.body).toHaveProperty('error');

    // Invalid key (illegal characters or > 200 chars)
    const badKey = await request(app)
      .put('/api/data/bad*key!with?illegal^characters')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({ value: 'hello' });
    expect(badKey.status).toBe(400);
  });

  // TEST 6: Token rejected after password change and after account deletion
  it('6. Token is rejected after password change and account deletion', async () => {
    // Create temporary user directly via model to not exhaust HTTP registration limiter
    const tempEmail = `temp_revoke_${Date.now()}@example.com`;
    const tempUser = await User.create({
      name: 'Revoke Test',
      email: tempEmail,
      password: 'OldPwd1!',
    });
    const originalToken = jwt.sign(
      { sub: String(tempUser.id), token_version: 0 },
      config.JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '15m' }
    );

    // Verify token works initially
    const check1 = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${originalToken}`);
    expect(check1.status).toBe(200);

    // Change password
    const pwdRes = await request(app)
      .put('/api/auth/password')
      .set('Authorization', `Bearer ${originalToken}`)
      .send({
        currentPassword: 'OldPwd1!',
        newPassword: 'NewPwd1!',
      });
    expect(pwdRes.status).toBe(200);
    const newToken = pwdRes.body.token;

    // Old token must now be rejected (token_version incremented)
    const checkOld = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${originalToken}`);
    expect(checkOld.status).toBe(401);

    // Delete account using new token
    const delRes = await request(app)
      .delete('/api/auth/account')
      .set('Authorization', `Bearer ${newToken}`);
    expect(delRes.status).toBe(200);

    // Even new token is now rejected because account is deleted (returns 401, never 500!)
    const checkDeleted = await request(app)
      .get('/api/data')
      .set('Authorization', `Bearer ${newToken}`);
    expect(checkDeleted.status).toBe(401);
  });

  // TEST 7: CORS rejects unknown origin
  it('7. CORS blocks untrusted origins with 403', async () => {
    const corsRes = await request(app)
      .get('/api/health')
      .set('Origin', 'https://evil-untrusted-hacker.com');
    expect(corsRes.status).toBe(403);
    expect(corsRes.body.error).toBe('CORS origin not allowed');
  });

  // TEST 8: Malformed JSON returns JSON without stack traces
  it('8. Malformed JSON returns clean JSON error without stack traces', async () => {
    const malformedRes = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{ "email": "bad json", incomplete... ');

    expect(malformedRes.status).toBe(400);
    expect(malformedRes.body).toHaveProperty('error');
    // Ensure no stack traces or source file paths are returned
    const bodyStr = JSON.stringify(malformedRes.body);
    expect(bodyStr).not.toContain('at ');
    expect(bodyStr).not.toContain('node_modules');
    expect(bodyStr).not.toContain('.js:');
  });

  // TEST 9: alg=none token is rejected
  it('9. Rejects forged alg=none JWT tokens with 401', async () => {
    // Forged token using alg=none with payload pointing to User A
    const headerBase64 = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payloadBase64 = Buffer.from(JSON.stringify({ sub: String(userAId), token_version: 0 })).toString('base64url');
    const forgedToken = `${headerBase64}.${payloadBase64}.`;

    const forgedRes = await request(app)
      .get('/api/data')
      .set('Authorization', `Bearer ${forgedToken}`);
    expect(forgedRes.status).toBe(401);
  });
});
