import app from './app.js';
import config from './config.js';
import { pool } from './db.js';
import { redis, connectRedis } from './redis.js';

async function main() {
  await pool.query('SELECT 1'); // fail fast if the database is unreachable
  await connectRedis(); // Redis is optional: the app starts even if it is down

  const server = app.listen(config.port, () => {
    console.log(`Flash-sale API listening on http://localhost:${config.port}`);
  });

  // Graceful shutdown: stop accepting requests, finish in-flight ones, close connections.
  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down...`);
    server.close(async () => {
      await pool.end().catch(() => {});
      await redis.quit().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Failed to start:', err.message);
  process.exit(1);
});
