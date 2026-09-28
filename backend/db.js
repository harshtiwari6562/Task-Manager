import mysql from 'mysql2/promise';

// Create a connection pool for efficient reuse
const pool = mysql.createPool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '3306'),
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME     || 'traject',
  waitForConnections: true,
  connectionLimit:    10,
  queueLimit:         0,
});

/**
 * Creates the required tables if they don't already exist.
 * Called once at server startup.
 */
export async function initDB() {
  const conn = await pool.getConnection();
  try {
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        name          VARCHAR(255)        NOT NULL,
        email         VARCHAR(255)        NOT NULL UNIQUE,
        password_hash VARCHAR(255)        NOT NULL,
        created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS user_data (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        user_id    INT          NOT NULL,
        \`key\`    VARCHAR(500) NOT NULL,
        value      LONGTEXT     NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_user_key (user_id, \`key\`),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    console.log('MySQL tables ready.');
  } finally {
    conn.release();
  }
}

export default pool;
