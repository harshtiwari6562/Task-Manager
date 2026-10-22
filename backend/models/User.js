import hasher from '../utils/hasher.js';
import pool from '../db.js';
import { invalidateAuthUserCache } from '../middleware/auth.js';

// Pre-computed bcrypt hash with cost 12 for constant-time comparisons when email is missing
const DUMMY_HASH = '$2a$12$K.zR1fCg7q8oNqCgIeVhheKxQoEw95rV8j2F27t7p4Q56P4sB1C0W';

const User = {
  /** Find a user by email. Returns row or null. */
  async findByEmail(email) {
    const [rows] = await pool.execute(
      'SELECT id, name, email, password_hash, token_version, created_at, updated_at FROM users WHERE email = ? LIMIT 1',
      [email.toLowerCase().trim()]
    );
    return rows[0] || null;
  },

  /** Find a user by primary key id. Returns row or null. */
  async findById(id) {
    const [rows] = await pool.execute(
      'SELECT id, name, email, password_hash, token_version, created_at, updated_at FROM users WHERE id = ? LIMIT 1',
      [id]
    );
    return rows[0] || null;
  },

  /** Create a new user. Returns the inserted row with id. */
  async create({ name, email, password }) {
    // Bcrypt cost 12 as per security requirement (offloaded to worker thread)
    const passwordHash = await hasher.hash(password, 12);
    const [result] = await pool.execute(
      'INSERT INTO users (name, email, password_hash, token_version) VALUES (?, ?, ?, 0)',
      [name.trim(), email.toLowerCase().trim(), passwordHash]
    );
    return {
      id: result.insertId,
      name: name.trim(),
      email: email.toLowerCase().trim(),
      token_version: 0,
    };
  },

  /** Verify a plain-text password against the stored hash (offloaded to worker thread) */
  async checkPassword(user, password) {
    if (!user || !user.password_hash) {
      // Run dummy compare to ensure constant-time response and prevent user enumeration
      await hasher.compare(password || '', DUMMY_HASH);
      return false;
    }
    return hasher.compare(password, user.password_hash);
  },

  /** Perform constant-time dummy compare when user does not exist */
  async dummyCompare(password) {
    await hasher.compare(password || '', DUMMY_HASH);
    return false;
  },

  /** Update password hash and increment token_version to revoke previous tokens */
  async setPassword(userId, newPassword) {
    const passwordHash = await hasher.hash(newPassword, 12);
    await pool.execute(
      'UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?',
      [passwordHash, userId]
    );
    invalidateAuthUserCache(userId);
  },

  /** Increment token_version to invalidate all existing tokens for this user */
  async incrementTokenVersion(userId) {
    await pool.execute(
      'UPDATE users SET token_version = token_version + 1 WHERE id = ?',
      [userId]
    );
    invalidateAuthUserCache(userId);
  },

  /** Delete a user and all their data (CASCADE handles user_data, refresh_tokens, ai_usage) */
  async deleteById(id) {
    invalidateAuthUserCache(id);
    await pool.execute('DELETE FROM users WHERE id = ?', [id]);
  },

  /** Return a safe (no password) representation of a user row. */
  toSafeJSON(user) {
    return { id: user.id, name: user.name, email: user.email };
  },
};

export default User;
