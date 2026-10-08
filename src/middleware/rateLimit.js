const config = require('../config');
const { AppError } = require('../errors');
const { incrWindow } = require('../redis');

/**
 * Per-user fixed-window rate limiter backed by Redis.
 * Protects the database from bots hammering checkout during a flash sale.
 * Fails open if Redis is down.
 */
function rateLimit(name) {
  return async (req, res, next) => {
    try {
      const { max, windowSec } = config.rateLimit; // read lazily so tests can change it
      const result = await incrWindow(`rl:${name}:${req.userId}`, windowSec);
      if (result && result.count > max) {
        res.set('Retry-After', String(Math.max(result.ttl, 1)));
        throw new AppError(429, 'RATE_LIMITED', 'Too many requests, slow down');
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { rateLimit };
