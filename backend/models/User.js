import bcrypt from 'bcryptjs';
import pool from '../db.js';

const User = {
  /** Find a user by email. Returns row or null. */
  async findByEmail(email) {
    const [rows] = await pool.execute(
      'SELECT * FROM users WHERE email = ? LIMIT 1',
      [email.toLowerCase().trim()]
    );
    return rows[0] || null;
  },

  /** Find a user by primary key id. Returns row or null. */
  async findById(id) {
    const [rows] = await pool.execute(
      'SELECT * FROM users WHERE id = ? LIMIT 1',
      [id]
    );
    return rows[0] || null;
  },

  /** Create a new user. Returns the inserted row with id. */
  async create({ name, email, password }) {
    const passwordHash = await bcrypt.hash(password, 10);
    const [result] = await pool.execute(
      'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
      [name.trim(), email.toLowerCase().trim(), passwordHash]
    );
    return { id: result.insertId, name: name.trim(), email: email.toLowerCase().trim() };
  },

  /** Verify a plain-text password against the stored hash. */
  async checkPassword(user, password) {
    return bcrypt.compare(password, user.password_hash);
  },

  /** Update the user's password hash. */
  async setPassword(userId, newPassword) {
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await pool.execute(
      'UPDATE users SET password_hash = ? WHERE id = ?',
      [passwordHash, userId]
    );
  },

  /** Delete a user and all their data (CASCADE handles user_data). */
  async deleteById(id) {
    await pool.execute('DELETE FROM users WHERE id = ?', [id]);
  },

  /** Return a safe (no password) representation of a user row. */
  toSafeJSON(user) {
    return { id: user.id, name: user.name, email: user.email };
  },
};

export default User;
