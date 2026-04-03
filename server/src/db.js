import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { Pool } from 'pg';
import { config } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_CONNECT_MAX_ATTEMPTS = 30;
const DB_CONNECT_RETRY_DELAY_MS = 1000;

export const pool = new Pool({
  connectionString: config.databaseUrl,
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForDatabase() {
  let lastError = null;

  for (let attempt = 1; attempt <= DB_CONNECT_MAX_ATTEMPTS; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      if (attempt > 1) {
        console.log(`Connected to database after ${attempt} attempts`);
      }
      return;
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt === DB_CONNECT_MAX_ATTEMPTS;
      console.warn(
        `Database not ready (attempt ${attempt}/${DB_CONNECT_MAX_ATTEMPTS}): ${error.message}`
      );
      if (isLastAttempt) break;
      await sleep(DB_CONNECT_RETRY_DELAY_MS);
    }
  }

  throw lastError;
}

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

export async function closeDb() {
  await pool.end();
}
