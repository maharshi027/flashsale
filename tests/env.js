// Runs before every test file. Uses a SEPARATE database/Redis DB so tests never touch dev data.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://postgres:2580@localhost:5432/flashsale_test';
process.env.REDIS_URL = process.env.TEST_REDIS_URL || 'redis://localhost:6379/1';
process.env.ADMIN_API_KEY = 'test-admin-key';
process.env.RATE_LIMIT_MAX = '1000';
