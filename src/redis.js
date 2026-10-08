const Redis = require('ioredis');
const config = require('./config');

/**
 * Redis is an OPTIMISATION layer here (cache, rate limit, sold-out flags).
 * PostgreSQL is the source of truth, so every helper below FAILS OPEN:
 * if Redis is down, the app keeps working (slower, but correct).
 */
const redis = new Redis(config.redisUrl, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  retryStrategy: (times) => Math.min(times * 200, 2000),
});

let warned = false;
redis.on('error', (err) => {
  if (!warned) {
    console.warn('Redis unavailable, running without cache/rate-limit:', err.message);
    warned = true;
  }
});
redis.on('ready', () => {
  warned = false;
});

async function connectRedis() {
  if (redis.status === 'wait' || redis.status === 'end') {
    try {
      await redis.connect();
    } catch (_) {
      /* fail open: app still starts without Redis */
    }
  }
}

async function safe(fn, fallback) {
  try {
    return await fn();
  } catch (_) {
    return fallback;
  }
}

const cache = {
  getJson: (key) =>
    safe(async () => {
      const raw = await redis.get(key);
      return raw ? JSON.parse(raw) : null;
    }, null),
  setJson: (key, value, ttlSec) =>
    safe(() => redis.set(key, JSON.stringify(value), 'EX', ttlSec), null),
  set: (key, value, ttlSec) => safe(() => redis.set(key, value, 'EX', ttlSec), null),
  del: (...keys) => (keys.length ? safe(() => redis.del(...keys), null) : null),
  mget: (keys) => safe(() => redis.mget(keys), keys.map(() => null)),
  isUp: () => redis.status === 'ready',
};

// Atomic "increment + set expiry on first hit" so the counter can never get stuck without a TTL.
const WINDOW_SCRIPT = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('TTL', KEYS[1])
return {c, ttl}
`;

/** Fixed-window counter. Returns { count, ttl } or null if Redis is unavailable. */
async function incrWindow(key, windowSec) {
  const out = await safe(() => redis.eval(WINDOW_SCRIPT, 1, key, windowSec), null);
  return out ? { count: out[0], ttl: out[1] } : null;
}

module.exports = { redis, cache, connectRedis, incrWindow };
