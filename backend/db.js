import mysql from 'mysql2/promise';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let poolInstance = null;

/**
 * Runs SQL migrations from the backend/migrations folder in sequential order.
 */
async function runMigrations(conn) {
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  const [appliedRows] = await conn.execute('SELECT name FROM schema_migrations');
  const appliedSet = new Set(appliedRows.map((r) => r.name));

  const migrationsDir = path.join(__dirname, 'migrations');
  let files = [];
  try {
    files = await fs.readdir(migrationsDir);
  } catch {
    console.warn('[DB] No migrations directory found, skipping migrations.');
    return;
  }

  const sqlFiles = files.filter((f) => f.endsWith('.sql')).sort();

  for (const file of sqlFiles) {
    if (!appliedSet.has(file)) {
      console.log(`[DB] Applying migration: ${file}`);
      const filePath = path.join(migrationsDir, file);
      const sqlContent = await fs.readFile(filePath, 'utf-8');

      // Split statements on semicolon followed by newline/whitespace
      const statements = sqlContent
        .split(/;\s*[\r\n]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      try {
        await conn.beginTransaction();
        for (const statement of statements) {
          await conn.query(statement);
        }
        await conn.execute('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
        await conn.commit();
        console.log(`[DB] Migration applied successfully: ${file}`);
      } catch (migErr) {
        try {
          await conn.rollback();
        } catch {}
        console.error(`[DB] Migration failed: ${file} - ${migErr.message}`);
        throw migErr;
      }
    }
  }
}

/**
 * Initializes MySQL connection, ensures database exists, and runs migrations.
 * Fails fast with clear error message without revealing sensitive passwords.
 */
export async function initDB() {
  try {
    // 1. Connect without specifying database to ensure database exists (local dev only)
    if (!config.DATABASE_URL && !config.DB_SSL && config.NODE_ENV !== 'production') {
      try {
        const serverConn = await mysql.createConnection({
          host: config.DB_HOST,
          port: config.DB_PORT,
          user: config.DB_USER,
          password: config.DB_PASSWORD,
          connectTimeout: 10000,
        });

        try {
          await serverConn.execute(
            `CREATE DATABASE IF NOT EXISTS \`${config.DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
          );
        } finally {
          await serverConn.end();
        }
      } catch (createDbErr) {
        // Ignored if user lacks global database creation privileges
        console.warn(`[DB] Automatic database check skipped: ${createDbErr.message}`);
      }
    }

    // 2. Create pool connected directly to the database (small pool: 5-10 connections)
    poolInstance = mysql.createPool({
      host: config.DB_HOST,
      port: config.DB_PORT,
      user: config.DB_USER,
      password: config.DB_PASSWORD,
      database: config.DB_NAME,
      waitForConnections: true,
      connectionLimit: 10,
      maxIdle: 5,
      idleTimeout: 30000,
      queueLimit: 500,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
      connectTimeout: 10000,
      charset: 'utf8mb4',
      ...(config.DB_SSL ? { ssl: { rejectUnauthorized: false } } : {}),
    });

    // Test connection & run migrations
    const conn = await poolInstance.getConnection();
    try {
      await runMigrations(conn);
    } finally {
      conn.release();
    }

    console.log(`[DB] Successfully connected to MySQL database: ${config.DB_NAME} (utf8mb4, SSL: ${Boolean(config.DB_SSL)})`);
  } catch (err) {
    console.error('\n========================================');
    console.error(`[DB] MySQL connection/initialization FAILED: ${err.message}`);
    console.error(`Host: ${config.DB_HOST}:${config.DB_PORT}, User: ${config.DB_USER}, DB: ${config.DB_NAME}`);
    console.error('========================================\n');
    throw new Error(`MySQL initialization failed: ${err.message}`);
  }
}

function isRetryable(err) {
  if (!err) return false;
  const code = err.code || '';
  return (
    code === 'ECONNRESET' ||
    code === 'PROTOCOL_CONNECTION_LOST' ||
    code === 'ETIMEDOUT' ||
    code === 'EPIPE'
  );
}

const pool = {
  async execute(sql, params) {
    if (!poolInstance) {
      throw new Error('Database pool not initialized. Wait for initDB() to complete.');
    }
    try {
      return await poolInstance.execute(sql, params);
    } catch (err) {
      if (isRetryable(err)) {
        console.warn(`[DB] Connection lost during execute (${err.code}). Retrying once...`);
        return await poolInstance.execute(sql, params);
      }
      throw err;
    }
  },
  async query(sql, params) {
    if (!poolInstance) {
      throw new Error('Database pool not initialized. Wait for initDB() to complete.');
    }
    try {
      return await poolInstance.query(sql, params);
    } catch (err) {
      if (isRetryable(err)) {
        console.warn(`[DB] Connection lost during query (${err.code}). Retrying once...`);
        return await poolInstance.query(sql, params);
      }
      throw err;
    }
  },
  getConnection() {
    if (!poolInstance) {
      throw new Error('Database pool not initialized. Wait for initDB() to complete.');
    }
    return poolInstance.getConnection();
  },
};

export default pool;
