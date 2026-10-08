import pg from 'pg';
import config from './config.js';

const { Pool, types } = pg;

// BIGINT (int8) columns come back as strings by default; our values fit in a JS number.
types.setTypeParser(20, (v) => parseInt(v, 10));

export const pool = new Pool({ connectionString: config.databaseUrl, max: config.dbPoolMax });
pool.on('error', (err) => console.error('Unexpected PostgreSQL pool error:', err.message));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RETRYABLE = new Set(['40001', '40P01']); // serialization_failure, deadlock_detected

/**
 * Runs `fn(client)` inside a transaction (BEGIN ... COMMIT).
 * Rolls back on any error. Retries automatically on deadlock / serialization
 * failures, which are *expected* under heavy concurrency and safe to retry.
 */
export async function withTransaction(fn, { retries = 3 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {
        /* connection may already be broken */
      }
      if (RETRYABLE.has(err.code) && attempt < retries) {
        await sleep(10 * 2 ** attempt + Math.random() * 10);
        continue;
      }
      throw err;
    } finally {
      client.release();
    }
  }
}

export default { pool, withTransaction };
