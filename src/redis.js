import Redis from 'ioredis';
import config from './config.js';

class MemoryStore {
  constructor() {
    this.store = new Map();
    this.ttls = new Map();
    this.expiresAt = new Map();
  }

  set(key, value, ttlSec) {
    this.store.set(key, String(value));
    if (this.ttls.has(key)) clearTimeout(this.ttls.get(key));
    if (ttlSec) {
      const exp = Date.now() + ttlSec * 1000;
      this.expiresAt.set(key, exp);
      const timer = setTimeout(() => {
        this.store.delete(key);
        this.ttls.delete(key);
        this.expiresAt.delete(key);
      }, ttlSec * 1000);
      timer.unref?.();
      this.ttls.set(key, timer);
    }
  }

  get(key) {
    return this.store.get(key) || null;
  }

  del(...keys) {
    let count = 0;
    for (const k of keys) {
      if (this.ttls.has(k)) {
        clearTimeout(this.ttls.get(k));
        this.ttls.delete(k);
        this.expiresAt.delete(k);
      }
      if (this.store.delete(k)) count++;
    }
    return count;
  }

  mget(keys) {
    return keys.map((k) => this.get(k));
  }

  incr(key, windowSec) {
    const prev = Number(this.store.get(key) || 0);
    const count = prev + 1;
    let ttl = windowSec;
    if (count === 1) {
      this.set(key, count, windowSec);
    } else {
      this.store.set(key, String(count));
      const exp = this.expiresAt.get(key);
      if (exp) {
        ttl = Math.max(1, Math.round((exp - Date.now()) / 1000));
      }
    }
    return { count, ttl };
  }

  flush() {
    for (const timer of this.ttls.values()) clearTimeout(timer);
    this.store.clear();
    this.ttls.clear();
    this.expiresAt.clear();
  }
}

const memoryStore = new MemoryStore();

/**
 * Redis is an OPTIMISATION layer here (cache, rate limit, sold-out flags).
 * PostgreSQL is the source of truth, so every helper below FAILS OPEN:
 * if Redis is down, the app keeps working with seamless in-memory fallback.
 */
export const redis = new Redis(config.redisUrl, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  retryStrategy: (times) => (times > 2 ? null : Math.min(times * 200, 1000)),
});

let warned = false;
redis.on('error', (err) => {
  if (!warned) {
    console.warn('Redis unavailable, running with in-memory cache/rate-limit fallback:', err.message);
    warned = true;
  }
});
redis.on('ready', () => {
  warned = false;
});

export async function connectRedis() {
  if (redis.status === 'wait' || redis.status === 'end') {
    try {
      await redis.connect();
    } catch (_) {
      /* fail open: app still starts with in-memory fallback */
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

export const cache = {
  getJson: async (key) => {
    if (redis.status === 'ready') {
      const raw = await safe(() => redis.get(key), null);
      if (raw !== null && raw !== undefined) {
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      }
      return null;
    }
    const raw = memoryStore.get(key);
    return raw ? JSON.parse(raw) : null;
  },
  setJson: async (key, value, ttlSec) => {
    const str = JSON.stringify(value);
    if (redis.status === 'ready') {
      return safe(() => redis.set(key, str, 'EX', ttlSec), null);
    }
    memoryStore.set(key, str, ttlSec);
    return 'OK';
  },
  set: async (key, value, ttlSec) => {
    if (redis.status === 'ready') {
      return safe(() => redis.set(key, value, 'EX', ttlSec), null);
    }
    memoryStore.set(key, value, ttlSec);
    return 'OK';
  },
  del: async (...keys) => {
    if (!keys.length) return null;
    if (redis.status === 'ready') {
      return safe(() => redis.del(...keys), null);
    }
    return memoryStore.del(...keys);
  },
  mget: async (keys) => {
    if (!keys.length) return [];
    if (redis.status === 'ready') {
      return safe(() => redis.mget(keys), keys.map(() => null));
    }
    return memoryStore.mget(keys);
  },
  isUp: () => redis.status === 'ready',
  isInMemory: () => redis.status !== 'ready',
  flush: () => memoryStore.flush(),
};

// Atomic "increment + set expiry on first hit" so the counter can never get stuck without a TTL.
const WINDOW_SCRIPT = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('TTL', KEYS[1])
return {c, ttl}
`;

/** Fixed-window counter. Returns { count, ttl } or in-memory fallback. */
export async function incrWindow(key, windowSec) {
  if (redis.status === 'ready') {
    const out = await safe(() => redis.eval(WINDOW_SCRIPT, 1, key, windowSec), null);
    if (out) return { count: out[0], ttl: out[1] };
  }
  return memoryStore.incr(key, windowSec);
}

export default { redis, cache, connectRedis, incrWindow };
