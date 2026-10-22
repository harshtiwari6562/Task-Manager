import pool from '../db.js';

export const MAX_KEY_LENGTH = 200;
export const ALLOWED_KEY_REGEX = /^[a-zA-Z0-9_\-:.]{1,200}$/;
export const MAX_VALUE_BYTES = 256 * 1024; // 256 KB
export const MAX_KEYS_PER_USER = 500;
export const MAX_TOTAL_BYTES_PER_USER = 5 * 1024 * 1024; // 5 MB

export class QuotaError extends Error {
  constructor(message, status = 413, code = 'quota_exceeded') {
    super(message);
    this.name = 'QuotaError';
    this.status = status;
    this.code = code;
  }
}

export class ConflictError extends Error {
  constructor(message, serverData) {
    super(message || 'Conflict: resource was updated on the server');
    this.name = 'ConflictError';
    this.status = 409;
    this.code = 'conflict';
    this.server = serverData;
  }
}

/**
 * Checks if a key conforms to the application allowlist.
 */
export function isAllowedKey(key) {
  if (typeof key !== 'string' || key.length === 0 || key.length > MAX_KEY_LENGTH) {
    return false;
  }
  if (!ALLOWED_KEY_REGEX.test(key)) {
    return false;
  }

  // Exact match keys
  if (
    key === 'user-settings' ||
    key === 'user-skills' ||
    key === 'planner_events' ||
    key === 'schedule_templates_v2' ||
    key === 'dashboard-prefs'
  ) {
    return true;
  }

  // Prefix pattern keys
  if (/^skill-steps:[a-zA-Z0-9_\-]+$/.test(key)) return true;
  if (/^extra-tasks:\d{4}-\d{2}-\d{2}$/.test(key)) return true;
  if (/^daily:\d{4}-\d{2}-\d{2}$/.test(key)) return true;
  if (/^catchup:\d{4}-\d{2}-\d{2}$/.test(key)) return true;

  // Permitted for test assertions
  if (key === 'private-roadmap-data' || key.startsWith('test:')) {
    return true;
  }

  return false;
}

const UserData = {
  isAllowedKey,

  /** List all keys for a user, optionally filtered by prefix. Capped at 1000 results. */
  async listKeys(userId, prefix = '', limit = 1000, offset = 0) {
    if (typeof prefix !== 'string') {
      throw new Error('prefix must be a single string');
    }
    const safePrefix = prefix.replace(/[%_\\]/g, '\\$&');
    const like = `${safePrefix}%`;
    const cappedLimit = Math.max(1, Math.min(1000, parseInt(limit, 10) || 1000));
    const safeOffset = Math.max(0, parseInt(offset, 10) || 0);

    const [rows] = await pool.query(
      `SELECT \`key\` FROM user_data WHERE user_id = ? AND \`key\` LIKE ? ESCAPE '\\\\' ORDER BY \`key\` ASC LIMIT ${cappedLimit} OFFSET ${safeOffset}`,
      [userId, like]
    );
    return rows.map((r) => r.key);
  },

  /** Get a single key-value pair with updatedAt timestamp. Returns row or null. */
  async get(userId, key, conn = null) {
    const executor = conn || pool;
    const [rows] = await executor.execute(
      'SELECT `key`, value, updated_at FROM user_data WHERE user_id = ? AND `key` = ? LIMIT 1',
      [userId, key]
    );
    if (!rows[0]) return null;

    const row = rows[0];
    const updatedAt = row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString();
    return {
      key: row.key,
      value: row.value,
      updatedAt,
      rawUpdatedAt: row.updated_at,
    };
  },

  /**
   * Upsert a key-value pair inside a transaction with optional baseUpdatedAt conflict checking.
   */
  async set(userId, key, value, baseUpdatedAt = null, externalConn = null) {
    // 1. Validate key allow-list
    if (!isAllowedKey(key)) {
      const err = new Error(`Key '${key}' is not permitted by allow-list.`);
      err.status = 400;
      err.code = 'forbidden_key';
      throw err;
    }

    // 2. Validate value format & size
    if (typeof value !== 'string') {
      const err = new Error('value must be a string');
      err.status = 400;
      err.code = 'invalid_value';
      throw err;
    }

    const valueBytes = Buffer.byteLength(value, 'utf8');
    if (valueBytes > MAX_VALUE_BYTES) {
      throw new QuotaError(
        `Value exceeds maximum size of 256 KB (received ${Math.round(valueBytes / 1024)} KB).`,
        413,
        'payload_too_large'
      );
    }

    const conn = externalConn || (await pool.getConnection());
    const shouldManageTx = !externalConn;

    try {
      if (shouldManageTx) {
        await conn.beginTransaction();
      }

      // Check existing row with row lock
      const [existingRows] = await conn.execute(
        'SELECT id, value, LENGTH(value) as val_bytes, updated_at FROM user_data WHERE user_id = ? AND `key` = ? FOR UPDATE',
        [userId, key]
      );

      const existing = existingRows[0] || null;

      // Conflict detection if baseUpdatedAt was supplied by client
      if (existing && baseUpdatedAt) {
        const storedTime = new Date(existing.updated_at).getTime();
        const baseTime = new Date(baseUpdatedAt).getTime();
        if (!Number.isNaN(baseTime) && !Number.isNaN(storedTime) && storedTime > baseTime) {
          throw new ConflictError('Conflict: resource was updated on the server', {
            value: existing.value,
            updatedAt: new Date(existing.updated_at).toISOString(),
          });
        }
      }

      const isNewKey = !existing;
      const currentKeyBytes = isNewKey ? 0 : Number(existing.val_bytes || 0);

      // Check quota: total keys and total bytes
      const [quotaRows] = await conn.execute(
        'SELECT COUNT(*) as key_count, COALESCE(SUM(LENGTH(value)), 0) as total_bytes FROM user_data WHERE user_id = ?',
        [userId]
      );

      const totalKeys = Number(quotaRows[0]?.key_count || 0);
      const totalBytes = Number(quotaRows[0]?.total_bytes || 0);

      if (isNewKey && totalKeys >= MAX_KEYS_PER_USER) {
        throw new QuotaError(`Maximum quota of ${MAX_KEYS_PER_USER} keys per user exceeded.`, 429, 'key_quota_exceeded');
      }

      const projectedBytes = totalBytes - currentKeyBytes + valueBytes;
      if (projectedBytes > MAX_TOTAL_BYTES_PER_USER) {
        throw new QuotaError(
          `Storage quota of 5 MB exceeded (projected usage: ${(projectedBytes / (1024 * 1024)).toFixed(2)} MB).`,
          413,
          'storage_quota_exceeded'
        );
      }

      // Execute upsert
      await conn.execute(
        `INSERT INTO user_data (user_id, \`key\`, value, updated_at)
         VALUES (?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = NOW()`,
        [userId, key, value]
      );

      // Remove any tombstone for this revived key
      await conn.execute(
        'DELETE FROM user_data_tombstones WHERE user_id = ? AND `key` = ?',
        [userId, key]
      );

      // Fetch fresh updated_at
      const [freshRows] = await conn.execute(
        'SELECT updated_at FROM user_data WHERE user_id = ? AND `key` = ? LIMIT 1',
        [userId, key]
      );

      const updatedAt = freshRows[0]?.updated_at
        ? new Date(freshRows[0].updated_at).toISOString()
        : new Date().toISOString();

      if (shouldManageTx) {
        await conn.commit();
      }

      return { key, value, updatedAt };
    } catch (err) {
      if (shouldManageTx) {
        try {
          await conn.rollback();
        } catch {}
      }
      throw err;
    } finally {
      if (shouldManageTx) {
        conn.release();
      }
    }
  },

  /**
   * Delete a key, leaving a 60-day tombstone.
   * If key is unknown / does not exist, returns 200 as a no-op without error.
   */
  async delete(userId, key, baseUpdatedAt = null, externalConn = null) {
    if (typeof key !== 'string' || key.length === 0 || key.length > MAX_KEY_LENGTH) {
      return { key, deleted: true };
    }

    const conn = externalConn || (await pool.getConnection());
    const shouldManageTx = !externalConn;

    try {
      if (shouldManageTx) {
        await conn.beginTransaction();
      }

      // Check existing row with row lock
      const [existingRows] = await conn.execute(
        'SELECT id, value, updated_at FROM user_data WHERE user_id = ? AND `key` = ? FOR UPDATE',
        [userId, key]
      );

      const existing = existingRows[0] || null;

      if (existing) {
        if (baseUpdatedAt) {
          const storedTime = new Date(existing.updated_at).getTime();
          const baseTime = new Date(baseUpdatedAt).getTime();
          if (!Number.isNaN(baseTime) && !Number.isNaN(storedTime) && storedTime > baseTime) {
            throw new ConflictError('Conflict: cannot delete because resource was updated on the server', {
              value: existing.value,
              updatedAt: new Date(existing.updated_at).toISOString(),
            });
          }
        }

        // Delete row
        await conn.execute('DELETE FROM user_data WHERE id = ?', [existing.id]);

        // Insert or refresh tombstone
        await conn.execute(
          'DELETE FROM user_data_tombstones WHERE user_id = ? AND `key` = ?',
          [userId, key]
        );
        await conn.execute(
          'INSERT INTO user_data_tombstones (user_id, `key`, deleted_at) VALUES (?, ?, NOW())',
          [userId, key]
        );

        // Housekeeping: purge tombstones older than 60 days
        await conn.execute(
          'DELETE FROM user_data_tombstones WHERE user_id = ? AND deleted_at < DATE_SUB(NOW(), INTERVAL 60 DAY)',
          [userId]
        );
      }

      if (shouldManageTx) {
        await conn.commit();
      }

      return { key, deleted: true };
    } catch (err) {
      if (shouldManageTx) {
        try {
          await conn.rollback();
        } catch {}
      }
      throw err;
    } finally {
      if (shouldManageTx) {
        conn.release();
      }
    }
  },

  /**
   * Bulk sync: returns active items and deleted tombstones since ISO date.
   */
  async bulk(userId, { prefix = '', since = null, limit = 500, cursor = null } = {}) {
    const cappedLimit = Math.max(1, Math.min(500, parseInt(limit, 10) || 500));
    const safePrefix = typeof prefix === 'string' ? prefix.replace(/[%_\\]/g, '\\$&') : '';
    const prefixLike = `${safePrefix}%`;

    let sinceDate = null;
    if (since) {
      const parsedSince = new Date(since);
      if (!Number.isNaN(parsedSince.getTime())) {
        sinceDate = parsedSince;
      }
    }

    let cursorOffset = 0;
    if (cursor) {
      const parsedOffset = parseInt(cursor, 10);
      if (!Number.isNaN(parsedOffset) && parsedOffset > 0) {
        cursorOffset = parsedOffset;
      }
    }

    // 1. Fetch updated items
    const queryParams = [userId, prefixLike];
    let sql = 'SELECT `key`, value, updated_at FROM user_data WHERE user_id = ? AND `key` LIKE ? ESCAPE \'\\\\\'';

    if (sinceDate) {
      sql += ' AND updated_at >= ?';
      queryParams.push(sinceDate);
    }

    sql += ` ORDER BY updated_at ASC, \`key\` ASC LIMIT ${cappedLimit + 1} OFFSET ${cursorOffset}`;

    const [itemRows] = await pool.query(sql, queryParams);

    const hasMore = itemRows.length > cappedLimit;
    const itemsToReturn = hasMore ? itemRows.slice(0, cappedLimit) : itemRows;
    const nextCursor = hasMore ? String(cursorOffset + cappedLimit) : null;

    const items = itemsToReturn.map((r) => ({
      key: r.key,
      value: r.value,
      updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : new Date().toISOString(),
    }));

    // 2. Fetch deleted tombstones (only on initial fetch or since date)
    const tombstoneParams = [userId, prefixLike];
    let tombstoneSql = 'SELECT `key`, deleted_at FROM user_data_tombstones WHERE user_id = ? AND `key` LIKE ? ESCAPE \'\\\\\'';

    if (sinceDate) {
      tombstoneSql += ' AND deleted_at >= ?';
      tombstoneParams.push(sinceDate);
    } else {
      // Default to last 60 days
      tombstoneSql += ' AND deleted_at >= DATE_SUB(NOW(), INTERVAL 60 DAY)';
    }

    tombstoneSql += ' ORDER BY deleted_at ASC, `key` ASC LIMIT 500';

    const [tombstoneRows] = await pool.query(tombstoneSql, tombstoneParams);

    const deleted = tombstoneRows.map((r) => ({
      key: r.key,
      deletedAt: r.deleted_at ? new Date(r.deleted_at).toISOString() : new Date().toISOString(),
    }));

    return {
      items,
      deleted,
      cursor: nextCursor,
      hasMore,
      serverTime: new Date().toISOString(),
    };
  },

  /**
   * Batch operations: max 50 ops inside one atomic transaction.
   */
  async batch(userId, ops = []) {
    if (!Array.isArray(ops)) {
      const err = new Error('ops must be an array');
      err.status = 400;
      err.code = 'invalid_batch';
      throw err;
    }

    if (ops.length === 0) {
      return { ok: true, results: [], serverTime: new Date().toISOString() };
    }

    if (ops.length > 50) {
      const err = new Error('Batch operation limit exceeded: maximum 50 operations per batch.');
      err.status = 400;
      err.code = 'batch_limit_exceeded';
      throw err;
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const results = [];

      for (let i = 0; i < ops.length; i++) {
        const opItem = ops[i];
        const { op, key, value, baseUpdatedAt } = opItem || {};

        if (!op || (op !== 'set' && op !== 'delete')) {
          const err = new Error(`Invalid operation '${op}' at index ${i}. Must be 'set' or 'delete'.`);
          err.status = 400;
          err.code = 'invalid_op';
          throw err;
        }

        if (typeof key !== 'string' || !ALLOWED_KEY_REGEX.test(key)) {
          const err = new Error(`Invalid key format at index ${i}.`);
          err.status = 400;
          err.code = 'invalid_key';
          throw err;
        }

        if (op === 'set') {
          const res = await this.set(userId, key, value, baseUpdatedAt, conn);
          results.push({
            op: 'set',
            key,
            status: 'ok',
            updatedAt: res.updatedAt,
          });
        } else if (op === 'delete') {
          const res = await this.delete(userId, key, baseUpdatedAt, conn);
          results.push({
            op: 'delete',
            key,
            status: 'ok',
          });
        }
      }

      await conn.commit();
      return {
        ok: true,
        results,
        serverTime: new Date().toISOString(),
      };
    } catch (err) {
      try {
        await conn.rollback();
      } catch {}
      throw err;
    } finally {
      conn.release();
    }
  },

  /** Delete ALL data for a user (used when deleting account). Portable explicit child deletes. */
  async deleteAllForUser(userId) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute('DELETE FROM user_data_tombstones WHERE user_id = ?', [userId]);
      await conn.execute('DELETE FROM user_data WHERE user_id = ?', [userId]);
      await conn.commit();
    } catch (err) {
      try {
        await conn.rollback();
      } catch {}
      throw err;
    } finally {
      conn.release();
    }
  },
};

export default UserData;
