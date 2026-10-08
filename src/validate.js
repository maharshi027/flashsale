import { AppError } from './errors.js';

export function positiveInt(value, name, { max = 2147483647, allowZero = false } = {}) {
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  const min = allowZero ? 0 : 1;
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new AppError(400, 'VALIDATION_ERROR', `${name} must be an integer between ${min} and ${max}`);
  }
  return n;
}

export function nonEmptyString(value, name, maxLen = 200) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLen) {
    throw new AppError(400, 'VALIDATION_ERROR', `${name} must be a non-empty string (max ${maxLen} chars)`);
  }
  return value.trim();
}

export default { positiveInt, nonEmptyString };
