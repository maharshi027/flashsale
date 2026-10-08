import config from '../config.js';
import { AppError } from '../errors.js';
import { positiveInt } from '../validate.js';

/**
 * Demo-level authentication: the caller identifies themselves with an
 * `X-User-Id` header. In production this would be a JWT / session.
 */
export function requireUser(req, _res, next) {
  const raw = req.get('X-User-Id');
  if (!raw) return next(new AppError(401, 'UNAUTHENTICATED', 'X-User-Id header is required'));
  try {
    req.userId = positiveInt(raw, 'X-User-Id');
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAdmin(req, _res, next) {
  if (req.get('X-Admin-Key') !== config.adminKey) {
    return next(new AppError(403, 'FORBIDDEN', 'Valid X-Admin-Key header required'));
  }
  next();
}

export default { requireUser, requireAdmin };
