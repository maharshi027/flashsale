const config = require('../config');
const { AppError } = require('../errors');
const { positiveInt } = require('../validate');

/**
 * Demo-level authentication: the caller identifies themselves with an
 * `X-User-Id` header. In production this would be a JWT / session.
 */
function requireUser(req, _res, next) {
  const raw = req.get('X-User-Id');
  if (!raw) return next(new AppError(401, 'UNAUTHENTICATED', 'X-User-Id header is required'));
  try {
    req.userId = positiveInt(raw, 'X-User-Id');
    next();
  } catch (err) {
    next(err);
  }
}

function requireAdmin(req, _res, next) {
  if (req.get('X-Admin-Key') !== config.adminKey) {
    return next(new AppError(403, 'FORBIDDEN', 'Valid X-Admin-Key header required'));
  }
  next();
}

module.exports = { requireUser, requireAdmin };
