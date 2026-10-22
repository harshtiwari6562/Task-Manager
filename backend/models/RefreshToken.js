import crypto from 'node:crypto';
import pool from '../db.js';

const RefreshToken = {
  /**
   * Hashes a raw refresh token using SHA-256 for secure storage.
   */
  hashToken(rawToken) {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
  },

  /**
   * Generates a 256-bit cryptographically secure refresh token and saves its SHA-256 hash.
   */
  async createToken(userId, daysValid = 30) {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);

    await pool.execute(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))`,
      [userId, tokenHash, daysValid]
    );

    return rawToken;
  },

  /**
   * Finds an active (unrevoked and non-expired) refresh token.
   */
  async findValidToken(rawToken) {
    const tokenHash = this.hashToken(rawToken);
    const [rows] = await pool.execute(
      `SELECT * FROM refresh_tokens 
       WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > NOW() 
       LIMIT 1`,
      [tokenHash]
    );
    return rows[0] || null;
  },

  /**
   * Revokes a specific token by its raw value.
   */
  async revokeToken(rawToken) {
    const tokenHash = this.hashToken(rawToken);
    await pool.execute(
      'UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = ? AND revoked_at IS NULL',
      [tokenHash]
    );
  },

  /**
   * Revokes all tokens belonging to a specific user (e.g. on password change or logout).
   */
  async revokeAllForUser(userId) {
    await pool.execute(
      'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL',
      [userId]
    );
  },
};

export default RefreshToken;
