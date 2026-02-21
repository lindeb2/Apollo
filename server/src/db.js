import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { config } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const pool = new Pool({
  connectionString: config.databaseUrl,
});

export async function runMigrations() {
  const migrationDir = path.join(__dirname, 'migrations');
  const files = (await fs.readdir(migrationDir)).filter((f) => f.endsWith('.sql')).sort();

  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  );

  for (const file of files) {
    const id = file;
    const existing = await pool.query('SELECT id FROM schema_migrations WHERE id = $1', [id]);
    if (existing.rowCount > 0) continue;

    const sql = await fs.readFile(path.join(migrationDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(id) VALUES($1)', [id]);
      await client.query('COMMIT');
      console.log(`Applied migration: ${id}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

export async function ensureDefaultAdmin() {
  const existing = await pool.query('SELECT id FROM users LIMIT 1');
  if (existing.rowCount > 0) return;

  const id = randomUUID();
  const hash = await bcrypt.hash(config.defaultAdminPassword, 12);
  await pool.query(
    `INSERT INTO users(id, username, password_hash, is_admin, is_active)
     VALUES($1, $2, $3, TRUE, TRUE)`,
    [id, config.defaultAdminUsername, hash]
  );

  console.log(`Created default admin user: ${config.defaultAdminUsername}`);
}

export async function closeDb() {
  await pool.end();
}
