import pool from '../db.js';

const UserData = {
  /** List all keys for a user, optionally filtered by prefix. */
  async listKeys(userId, prefix = '') {
    const like = `${prefix.replace(/[%_\\]/g, '\\$&')}%`;
    const [rows] = await pool.execute(
      'SELECT `key` FROM user_data WHERE user_id = ? AND `key` LIKE ? ESCAPE \'\\\\\'',
      [userId, like]
    );
    return rows.map((r) => r.key);
  },

  /** Get a single key-value pair. Returns row or null. */
  async get(userId, key) {
    const [rows] = await pool.execute(
      'SELECT `key`, value FROM user_data WHERE user_id = ? AND `key` = ? LIMIT 1',
      [userId, key]
    );
    return rows[0] || null;
  },

  /** Upsert (insert or update) a key-value pair. Returns the saved row. */
  async set(userId, key, value) {
    await pool.execute(
      `INSERT INTO user_data (user_id, \`key\`, value)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = CURRENT_TIMESTAMP`,
      [userId, key, value]
    );
    return { key, value };
  },

  /** Delete a key. */
  async delete(userId, key) {
    await pool.execute(
      'DELETE FROM user_data WHERE user_id = ? AND `key` = ?',
      [userId, key]
    );
  },

  /** Delete ALL data for a user (used when deleting account). */
  async deleteAllForUser(userId) {
    await pool.execute('DELETE FROM user_data WHERE user_id = ?', [userId]);
  },
};

export default UserData;
