import pool from '../db.js';
import config from '../config.js';

export class AiLimitError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AiLimitError';
    this.status = 429;
  }
}

const AiUsage = {
  /**
   * Checks hourly/daily user limits and global daily limit in MySQL.
   * If within limits, records the usage and returns true.
   */
  async checkAndRecord(userId, endpoint = 'generate-skill') {
    // 1. Check user requests in last 1 hour (max 20)
    const [hourlyRows] = await pool.execute(
      `SELECT COUNT(*) as cnt FROM ai_usage 
       WHERE user_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)`,
      [userId]
    );
    if (Number(hourlyRows[0]?.cnt || 0) >= 20) {
      throw new AiLimitError('Aapki AI request limit (20 per hour) reach ho gayi hai. Kripya thodi der baad try karein.');
    }

    // 2. Check user requests in last 24 hours (max 100)
    const [dailyRows] = await pool.execute(
      `SELECT COUNT(*) as cnt FROM ai_usage 
       WHERE user_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)`,
      [userId]
    );
    if (Number(dailyRows[0]?.cnt || 0) >= 100) {
      throw new AiLimitError('Aapki aaj ki AI request limit (100 per day) reach ho gayi hai. Kripya kal try karein.');
    }

    // 3. Check global daily cap
    const [globalRows] = await pool.execute(
      `SELECT COUNT(*) as cnt FROM ai_usage 
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)`
    );
    if (Number(globalRows[0]?.cnt || 0) >= config.AI_GLOBAL_DAILY_LIMIT) {
      throw new AiLimitError('Global AI capacity full ho gayi hai. Kripya thodi der baad try karein.');
    }

    // Record usage
    await pool.execute(
      'INSERT INTO ai_usage (user_id, endpoint) VALUES (?, ?)',
      [userId, endpoint]
    );
  },
};

export default AiUsage;
