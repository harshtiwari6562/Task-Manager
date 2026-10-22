import { Router } from 'express';
import { z } from 'zod';
import pool from '../db.js';
import UserData, { QuotaError } from '../models/UserData.js';
import { notifySync } from '../services/pushService.js';

const router = Router();
const dateKeyRegex = /^\d{4}-\d{2}-\d{2}$/;

const extraTaskSchema = z
  .object({
    title: z.string().trim().min(1, 'Title is required').max(200, 'Title max 200 characters'),
    skill: z.string().max(100).optional().default('personal'),
    duration: z.string().max(50).optional().default('30 min'),
    time: z.string().max(50).optional().default('Extra Task'),
  })
  .passthrough();

// PUT /api/extra-tasks/:dateKey/:id
router.put('/:dateKey/:id', async (req, res) => {
  const { dateKey, id } = req.params;
  if (!dateKeyRegex.test(dateKey)) {
    return res.status(400).json({ error: 'dateKey must be in format YYYY-MM-DD', code: 'invalid_date' });
  }
  if (!id || typeof id !== 'string' || id.length > 100) {
    return res.status(400).json({ error: 'Invalid task id parameter', code: 'invalid_id' });
  }

  const parsed = extraTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0]?.message || 'Invalid extra task data',
      code: 'validation_error',
    });
  }

  const storageKey = `extra-tasks:${dateKey}`;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.execute(
      'SELECT id, value, updated_at FROM user_data WHERE user_id = ? AND `key` = ? FOR UPDATE',
      [req.userId, storageKey]
    );

    let tasks = [];
    if (rows[0]?.value) {
      try {
        const p = JSON.parse(rows[0].value);
        if (Array.isArray(p)) tasks = p;
      } catch {}
    }

    const index = tasks.findIndex((t) => String(t.id) === String(id));
    const mergedItem = index >= 0
      ? { ...tasks[index], ...parsed.data, id, time: parsed.data.time || 'Extra Task' }
      : { ...parsed.data, id, time: parsed.data.time || 'Extra Task' };

    if (index >= 0) {
      tasks[index] = mergedItem;
    } else {
      tasks.push(mergedItem);
    }

    const saveRes = await UserData.set(
      req.userId,
      storageKey,
      JSON.stringify(tasks),
      null,
      conn
    );

    await conn.commit();
    notifySync(req.userId, [storageKey]);

    return res.json({
      ok: true,
      updatedAt: saveRes.updatedAt,
      item: mergedItem,
    });
  } catch (err) {
    try { await conn.rollback(); } catch {}
    if (err instanceof QuotaError || err.status === 413 || err.status === 429) {
      return res.status(err.status || 413).json({ error: err.message, code: err.code || 'quota_exceeded' });
    }
    console.error('[ExtraTasks] PUT error:', err.message);
    return res.status(500).json({ error: 'Failed to save extra task', code: 'server_error' });
  } finally {
    conn.release();
  }
});

// DELETE /api/extra-tasks/:dateKey/:id
router.delete('/:dateKey/:id', async (req, res) => {
  const { dateKey, id } = req.params;
  if (!dateKeyRegex.test(dateKey)) {
    return res.status(400).json({ error: 'dateKey must be in format YYYY-MM-DD', code: 'invalid_date' });
  }
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Invalid task id parameter', code: 'invalid_id' });
  }

  const storageKey = `extra-tasks:${dateKey}`;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.execute(
      'SELECT id, value, updated_at FROM user_data WHERE user_id = ? AND `key` = ? FOR UPDATE',
      [req.userId, storageKey]
    );

    let tasks = [];
    if (rows[0]?.value) {
      try {
        const p = JSON.parse(rows[0].value);
        if (Array.isArray(p)) tasks = p;
      } catch {}
    }

    const initialLen = tasks.length;
    tasks = tasks.filter((t) => String(t.id) !== String(id));

    let updatedAt = new Date().toISOString();
    if (tasks.length !== initialLen) {
      const saveRes = await UserData.set(
        req.userId,
        storageKey,
        JSON.stringify(tasks),
        null,
        conn
      );
      updatedAt = saveRes.updatedAt;
    }

    await conn.commit();
    notifySync(req.userId, [storageKey]);

    return res.json({
      ok: true,
      updatedAt,
      item: null,
    });
  } catch (err) {
    try { await conn.rollback(); } catch {}
    console.error('[ExtraTasks] DELETE error:', err.message);
    return res.status(500).json({ error: 'Failed to delete extra task', code: 'server_error' });
  } finally {
    conn.release();
  }
});

export default router;
