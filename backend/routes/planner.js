import { Router } from 'express';
import { z } from 'zod';
import pool from '../db.js';
import UserData, { QuotaError } from '../models/UserData.js';
import { refreshReminderIndex } from '../services/reminderIndex.js';
import { notifySync } from '../services/pushService.js';

const router = Router();

const eventTimeRegex = /^(0?[1-9]|1[0-2]):[0-5][0-9] (AM|PM)$/;
const dateKeyRegex = /^\d{4}-\d{2}-\d{2}$/;

const putEventSchema = z
  .object({
    dateKey: z.string().regex(dateKeyRegex, 'dateKey must be in format YYYY-MM-DD'),
    title: z.string().trim().min(1, 'Title is required').max(200, 'Title max 200 characters'),
    time: z.string().regex(eventTimeRegex, 'Time must match format HH:MM AM/PM e.g. 09:00 AM'),
    category: z.string().max(40).optional().default('General'),
    done: z.boolean().optional().default(false),
    enableNotification: z.boolean().optional().default(true),
    mode: z.enum(['alarm', 'notification']).optional().default('notification'),
    leadMinutes: z
      .union([z.literal(0), z.literal(5), z.literal(10), z.literal(30)])
      .optional()
      .default(0),
  })
  .passthrough(); // preserves unknown fields

const patchEventSchema = z
  .object({
    dateKey: z.string().regex(dateKeyRegex, 'dateKey must be in format YYYY-MM-DD').optional(),
    title: z.string().trim().min(1).max(200).optional(),
    time: z.string().regex(eventTimeRegex, 'Time must match format HH:MM AM/PM').optional(),
    category: z.string().max(40).optional(),
    done: z.boolean().optional(),
    enableNotification: z.boolean().optional(),
    mode: z.enum(['alarm', 'notification']).optional(),
    leadMinutes: z
      .union([z.literal(0), z.literal(5), z.literal(10), z.literal(30)])
      .optional(),
  })
  .passthrough();

// GET /api/planner/events?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/events', async (req, res) => {
  try {
    const { from, to } = req.query;
    if (from && typeof from === 'string' && !dateKeyRegex.test(from)) {
      return res.status(400).json({ error: 'from parameter must match YYYY-MM-DD', code: 'invalid_date' });
    }
    if (to && typeof to === 'string' && !dateKeyRegex.test(to)) {
      return res.status(400).json({ error: 'to parameter must match YYYY-MM-DD', code: 'invalid_date' });
    }

    const doc = await UserData.get(req.userId, 'planner_events');
    let events = [];
    if (doc?.value) {
      try {
        const parsed = JSON.parse(doc.value);
        if (Array.isArray(parsed)) events = parsed;
      } catch {}
    }

    if (from || to) {
      events = events.filter((ev) => {
        if (!ev.dateKey) return false;
        if (from && ev.dateKey < from) return false;
        if (to && ev.dateKey > to) return false;
        return true;
      });
    }

    return res.json({ events, count: events.length });
  } catch (err) {
    console.error('[Planner] GET /events error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch planner events', code: 'server_error' });
  }
});

// PUT /api/planner/events/:id (upsert by client-provided id)
router.put('/events/:id', async (req, res) => {
  const { id } = req.params;
  if (!id || typeof id !== 'string' || id.length > 100) {
    return res.status(400).json({ error: 'Invalid event id parameter', code: 'invalid_id' });
  }

  const parsed = putEventSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0]?.message || 'Invalid event data',
      code: 'validation_error',
    });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.execute(
      'SELECT id, value, updated_at FROM user_data WHERE user_id = ? AND `key` = ? FOR UPDATE',
      [req.userId, 'planner_events']
    );

    let events = [];
    if (rows[0]?.value) {
      try {
        const p = JSON.parse(rows[0].value);
        if (Array.isArray(p)) events = p;
      } catch {}
    }

    const index = events.findIndex((e) => String(e.id) === String(id));
    const mergedItem = index >= 0
      ? { ...events[index], ...parsed.data, id }
      : { ...parsed.data, id };

    if (index >= 0) {
      events[index] = mergedItem;
    } else {
      events.push(mergedItem);
    }

    const saveRes = await UserData.set(
      req.userId,
      'planner_events',
      JSON.stringify(events),
      null,
      conn
    );

    await conn.commit();

    refreshReminderIndex(req.userId).catch(() => {});
    notifySync(req.userId, ['planner_events']);

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
    console.error('[Planner] PUT /events/:id error:', err.message);
    return res.status(500).json({ error: 'Failed to save planner event', code: 'server_error' });
  } finally {
    conn.release();
  }
});

// PATCH /api/planner/events/:id (partial update)
router.patch('/events/:id', async (req, res) => {
  const { id } = req.params;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Invalid event id parameter', code: 'invalid_id' });
  }

  const parsed = patchEventSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0]?.message || 'Invalid event data',
      code: 'validation_error',
    });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.execute(
      'SELECT id, value, updated_at FROM user_data WHERE user_id = ? AND `key` = ? FOR UPDATE',
      [req.userId, 'planner_events']
    );

    let events = [];
    if (rows[0]?.value) {
      try {
        const p = JSON.parse(rows[0].value);
        if (Array.isArray(p)) events = p;
      } catch {}
    }

    const index = events.findIndex((e) => String(e.id) === String(id));
    if (index === -1) {
      await conn.rollback();
      return res.status(404).json({ error: 'Event not found', code: 'not_found' });
    }

    const updatedItem = { ...events[index], ...parsed.data, id };
    events[index] = updatedItem;

    const saveRes = await UserData.set(
      req.userId,
      'planner_events',
      JSON.stringify(events),
      null,
      conn
    );

    await conn.commit();

    refreshReminderIndex(req.userId).catch(() => {});
    notifySync(req.userId, ['planner_events']);

    return res.json({
      ok: true,
      updatedAt: saveRes.updatedAt,
      item: updatedItem,
    });
  } catch (err) {
    try { await conn.rollback(); } catch {}
    if (err instanceof QuotaError || err.status === 413 || err.status === 429) {
      return res.status(err.status || 413).json({ error: err.message, code: err.code || 'quota_exceeded' });
    }
    console.error('[Planner] PATCH /events/:id error:', err.message);
    return res.status(500).json({ error: 'Failed to update planner event', code: 'server_error' });
  } finally {
    conn.release();
  }
});

// DELETE /api/planner/events/:id
router.delete('/events/:id', async (req, res) => {
  const { id } = req.params;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Invalid event id parameter', code: 'invalid_id' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.execute(
      'SELECT id, value, updated_at FROM user_data WHERE user_id = ? AND `key` = ? FOR UPDATE',
      [req.userId, 'planner_events']
    );

    let events = [];
    if (rows[0]?.value) {
      try {
        const p = JSON.parse(rows[0].value);
        if (Array.isArray(p)) events = p;
      } catch {}
    }

    const initialLen = events.length;
    events = events.filter((e) => String(e.id) !== String(id));

    let updatedAt = new Date().toISOString();
    if (events.length !== initialLen) {
      const saveRes = await UserData.set(
        req.userId,
        'planner_events',
        JSON.stringify(events),
        null,
        conn
      );
      updatedAt = saveRes.updatedAt;
    }

    await conn.commit();

    refreshReminderIndex(req.userId).catch(() => {});
    notifySync(req.userId, ['planner_events']);

    return res.json({
      ok: true,
      updatedAt,
      item: null,
    });
  } catch (err) {
    try { await conn.rollback(); } catch {}
    console.error('[Planner] DELETE /events/:id error:', err.message);
    return res.status(500).json({ error: 'Failed to delete planner event', code: 'server_error' });
  } finally {
    conn.release();
  }
});

export default router;
