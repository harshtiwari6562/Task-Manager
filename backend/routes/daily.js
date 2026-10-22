import { Router } from 'express';
import { z } from 'zod';
import pool from '../db.js';
import UserData, { QuotaError } from '../models/UserData.js';
import { notifySync } from '../services/pushService.js';

const router = Router();
const dateKeyRegex = /^\d{4}-\d{2}-\d{2}$/;

const dailyStatusSchema = z.object({
  done: z.boolean({ required_error: 'done is required and must be boolean' }),
});

// PUT /api/daily/:dateKey/:taskId { done: boolean }
router.put('/:dateKey/:taskId', async (req, res) => {
  const { dateKey, taskId } = req.params;
  if (!dateKeyRegex.test(dateKey)) {
    return res.status(400).json({ error: 'dateKey must be in format YYYY-MM-DD', code: 'invalid_date' });
  }
  if (!taskId || typeof taskId !== 'string' || taskId.length > 100) {
    return res.status(400).json({ error: 'Invalid taskId parameter', code: 'invalid_id' });
  }

  const parsed = dailyStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0]?.message || 'Invalid body, done: boolean required',
      code: 'validation_error',
    });
  }

  const storageKey = `daily:${dateKey}`;
  const { done } = parsed.data;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.execute(
      'SELECT id, value, updated_at FROM user_data WHERE user_id = ? AND `key` = ? FOR UPDATE',
      [req.userId, storageKey]
    );

    let map = {};
    if (rows[0]?.value) {
      try {
        const p = JSON.parse(rows[0].value);
        if (p && typeof p === 'object' && !Array.isArray(p)) map = p;
      } catch {}
    }

    if (done) {
      map[taskId] = true;
    } else {
      delete map[taskId];
    }

    const saveRes = await UserData.set(
      req.userId,
      storageKey,
      JSON.stringify(map),
      null,
      conn
    );

    await conn.commit();
    notifySync(req.userId, [storageKey]);

    return res.json({
      ok: true,
      updatedAt: saveRes.updatedAt,
      item: { taskId, done },
    });
  } catch (err) {
    try { await conn.rollback(); } catch {}
    if (err instanceof QuotaError || err.status === 413 || err.status === 429) {
      return res.status(err.status || 413).json({ error: err.message, code: err.code || 'quota_exceeded' });
    }
    console.error('[Daily] PUT error:', err.message);
    return res.status(500).json({ error: 'Failed to update daily task status', code: 'server_error' });
  } finally {
    conn.release();
  }
});

export default router;
