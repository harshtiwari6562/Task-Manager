import { DatabaseSync } from 'node:sqlite';
import mysql from 'mysql2/promise';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import config from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'traject.db');

async function runImport() {
  if (!fs.existsSync(dbPath)) {
    console.log(`[Import] SQLite database file not found at ${dbPath}. Nothing to import.`);
    return;
  }

  console.log(`[Import] Opening SQLite database from ${dbPath}...`);
  const sqlite = new DatabaseSync(dbPath);

  console.log(`[Import] Connecting to MySQL (${config.DB_NAME} at ${config.DB_HOST})...`);
  const conn = await mysql.createConnection({
    host: config.DB_HOST,
    port: config.DB_PORT,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    database: config.DB_NAME,
  });

  try {
    // 1. Read users from SQLite
    const users = sqlite.prepare('SELECT * FROM users').all();
    console.log(`[Import] Found ${users.length} users in SQLite.`);

    for (const u of users) {
      await conn.execute(
        `INSERT INTO users (id, name, email, password_hash, token_version, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, COALESCE(?, NOW()), COALESCE(?, NOW()))
         ON DUPLICATE KEY UPDATE name = VALUES(name), password_hash = VALUES(password_hash)`,
        [u.id, u.name, u.email, u.password_hash, u.created_at, u.updated_at]
      );
    }
    console.log(`[Import] Users imported successfully.`);

    // 2. Read user_data from SQLite
    const dataRows = sqlite.prepare('SELECT * FROM user_data').all();
    console.log(`[Import] Found ${dataRows.length} user_data rows in SQLite.`);

    for (const d of dataRows) {
      await conn.execute(
        `INSERT INTO user_data (id, user_id, \`key\`, value, created_at, updated_at)
         VALUES (?, ?, ?, ?, COALESCE(?, NOW()), COALESCE(?, NOW()))
         ON DUPLICATE KEY UPDATE value = VALUES(value)`,
        [d.id, d.user_id, d.key, d.value, d.created_at, d.updated_at]
      );
    }
    console.log(`[Import] user_data rows imported successfully.`);

    // 3. Delete the test accounts as requested: test@example.com and tester@example.com
    const [delRes] = await conn.execute(
      "DELETE FROM users WHERE email IN ('test@example.com', 'tester@example.com')"
    );
    console.log(`[Import] Deleted test accounts test@example.com and tester@example.com (${delRes.affectedRows} user(s) removed).`);

    // Verify current counts
    const [finalUsers] = await conn.execute('SELECT id, name, email FROM users');
    const [finalData] = await conn.execute('SELECT COUNT(*) as count FROM user_data');
    console.log(`[Import] Completed! Current MySQL users:`, finalUsers);
    console.log(`[Import] Current MySQL user_data row count:`, finalData[0].count);
    console.log(`\n[NOTE] SQLite traject.db is preserved. Please confirm before deleting traject.db.`);
  } finally {
    await conn.end();
  }
}

runImport().catch((err) => {
  console.error('[Import] Failed with error:', err.message);
  process.exit(1);
});
