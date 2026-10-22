import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import UserData, {
  ALLOWED_KEY_REGEX,
  QuotaError,
  ConflictError,
  isAllowedKey,
} from '../models/UserData.js';

const router = Router();

// Validate key parameter middleware
function validateKeyParam(req, res, next) {
  const { key } = req.params;
  if (!key || typeof key !== 'string' || !ALLOWED_KEY_REGEX.test(key)) {
    return res.status(400).json({
      error: 'Invalid key name. Key must match /^[a-zA-Z0-9_\\-:.]{1,200}$/ (max 200 characters).',
      code: 'invalid_key',
    });
  }
  next();
}

const batchSchema = z.object({
  ops: z
    .array(
      z.object({
        op: z.enum(['set', 'delete'], {
          errorMap: () => ({ message: "Operation must be either 'set' or 'delete'" }),
        }),
        key: z
          .string()
          .min(1, 'Key cannot be empty')
          .max(200, 'Key must not exceed 200 characters')
          .regex(ALLOWED_KEY_REGEX, 'Key format invalid'),
        value: z.string().optional(),
        baseUpdatedAt: z.string().optional(),
      })
    )
    .min(1, 'ops array must not be empty')
    .max(50, 'ops array cannot exceed 50 operations'),
});

// GET /api/data?prefix=some:prefix&limit=1000&offset=0  ->  { keys: [...] }
router.get('/', async (req, res) => {
  try {
    const rawPrefix = req.query.prefix;
    if (rawPrefix !== undefined && typeof rawPrefix !== 'string') {
      return res.status(400).json({ error: 'prefix parameter must be a single string', code: 'invalid_prefix' });
    }
    const prefix = rawPrefix || '';
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 1000;
    const offset = req.query.offset ? parseInt(req.query.offset, 10) : 0;

    const keys = await UserData.listKeys(req.userId, prefix, limit, offset);

    // ETag & Cache-Control for traffic reduction
    res.setHeader('Cache-Control', 'private, no-cache');
    const etag = `W/"${keys.length}-${crypto.createHash('md5').update(keys.join(',')).digest('hex').slice(0, 12)}"`;
    res.setHeader('ETag', etag);

    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    return res.json({ keys });
  } catch (err) {
    console.error('List keys error:', err.message);
    return res.status(500).json({ error: 'Failed to list keys', code: 'server_error' });
  }
});

// GET /api/data/bulk?prefix=&since=ISO -> { items: [{key, value, updatedAt}], deleted: [{key, deletedAt}], cursor, hasMore, serverTime }
router.get('/bulk', async (req, res) => {
  try {
    const prefix = typeof req.query.prefix === 'string' ? req.query.prefix : '';
    const since = typeof req.query.since === 'string' ? req.query.since : null;
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 500;
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : null;

    const result = await UserData.bulk(req.userId, { prefix, since, limit, cursor });

    res.setHeader('Cache-Control', 'private, no-cache');
    const hash = crypto
      .createHash('md5')
      .update(JSON.stringify(result.items) + JSON.stringify(result.deleted) + (result.cursor || ''))
      .digest('hex')
      .slice(0, 16);
    const etag = `W/"bulk-${result.items.length}-${result.deleted.length}-${hash}"`;
    res.setHeader('ETag', etag);

    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    return res.json(result);
  } catch (err) {
    console.error('Bulk sync error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch bulk sync data', code: 'server_error' });
  }
});

// POST /api/data/batch { ops: [{op, key, value, baseUpdatedAt}] }
router.post('/batch', async (req, res) => {
  try {
    const parsed = batchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid batch payload',
        code: 'invalid_batch',
      });
    }

    // Validate that 'set' operations provide a string value
    for (const opItem of parsed.data.ops) {
      if (opItem.op === 'set' && typeof opItem.value !== 'string') {
        return res.status(400).json({
          error: `Operation 'set' for key '${opItem.key}' requires a string 'value'.`,
          code: 'invalid_value',
        });
      }
    }

    const batchResult = await UserData.batch(req.userId, parsed.data.ops);
    return res.json(batchResult);
  } catch (err) {
    if (err instanceof ConflictError || err.status === 409 || err.code === 'conflict') {
      return res.status(409).json({
        error: err.message,
        code: 'conflict',
        server: err.server || null,
      });
    }
    if (err instanceof QuotaError || err.status === 413 || err.status === 429) {
      return res.status(err.status || 413).json({
        error: err.message,
        code: err.code || 'quota_exceeded',
      });
    }
    if (err.status === 400 || err.code === 'forbidden_key') {
      return res.status(400).json({
        error: err.message,
        code: err.code || 'bad_request',
      });
    }
    console.error('Batch data error:', err.message);
    return res.status(500).json({ error: 'Failed to process batch data', code: 'server_error' });
  }
});

// GET /api/data/:key  ->  { key, value, updatedAt }
router.get('/:key', validateKeyParam, async (req, res) => {
  try {
    const doc = await UserData.get(req.userId, req.params.key);
    if (!doc) return res.status(404).json({ error: 'Not found', code: 'not_found' });

    // ETag & Cache-Control for traffic reduction
    res.setHeader('Cache-Control', 'private, no-cache');
    const hash = crypto
      .createHash('md5')
      .update(`${doc.value}:${doc.updatedAt}`)
      .digest('hex')
      .slice(0, 16);
    const etag = `"${Buffer.byteLength(doc.value)}-${hash}"`;
    res.setHeader('ETag', etag);

    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    return res.json({ key: doc.key, value: doc.value, updatedAt: doc.updatedAt });
  } catch (err) {
    console.error('Get key error:', err.message);
    return res.status(500).json({ error: 'Failed to read key', code: 'server_error' });
  }
});

// PUT /api/data/:key  body: { value, baseUpdatedAt? }  ->  { key, value, updatedAt }
router.put('/:key', validateKeyParam, async (req, res) => {
  try {
    const { value, baseUpdatedAt } = req.body || {};
    if (typeof value !== 'string') {
      return res.status(400).json({ error: 'value must be a string', code: 'invalid_value' });
    }

    if (!isAllowedKey(req.params.key)) {
      return res.status(400).json({
        error: `Key '${req.params.key}' is not allowed by application key allow-list.`,
        code: 'forbidden_key',
      });
    }

    const doc = await UserData.set(req.userId, req.params.key, value, baseUpdatedAt);
    return res.json(doc);
  } catch (err) {
    if (err instanceof ConflictError || err.status === 409 || err.code === 'conflict') {
      return res.status(409).json({
        error: err.message,
        code: 'conflict',
        server: err.server || null,
      });
    }
    if (err instanceof QuotaError || err.status === 413 || err.status === 429) {
      return res.status(err.status || 413).json({
        error: err.message,
        code: err.code || 'quota_exceeded',
      });
    }
    if (err.status === 400 || err.code === 'forbidden_key') {
      return res.status(400).json({
        error: err.message,
        code: err.code || 'bad_request',
      });
    }
    console.error('Set key error:', err.message);
    return res.status(500).json({ error: 'Failed to save key', code: 'server_error' });
  }
});

// DELETE /api/data/:key  ->  { key, deleted: true }
// Note: DELETE of an unknown key returns 200 as a no-op (the web app deletes old keys).
router.delete('/:key', validateKeyParam, async (req, res) => {
  try {
    const baseUpdatedAt = req.body?.baseUpdatedAt || req.query?.baseUpdatedAt || null;
    await UserData.delete(req.userId, req.params.key, baseUpdatedAt);
    return res.json({ key: req.params.key, deleted: true });
  } catch (err) {
    if (err instanceof ConflictError || err.status === 409 || err.code === 'conflict') {
      return res.status(409).json({
        error: err.message,
        code: 'conflict',
        server: err.server || null,
      });
    }
    console.error('Delete key error:', err.message);
    return res.status(500).json({ error: 'Failed to delete key', code: 'server_error' });
  }
});

export default router;
