import 'dotenv/config';

const int = (value, fallback) =>
  value === undefined || value === '' ? fallback : parseInt(value, 10);

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: int(process.env.PORT, 3000),
  databaseUrl:
    process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/flashsale',
  dbPoolMax: int(process.env.DB_POOL_MAX, 20),
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  adminKey: process.env.ADMIN_API_KEY || 'dev-admin-key',
  productCacheTtlSec: int(process.env.PRODUCT_CACHE_TTL_SEC, 30),
  soldOutFlagTtlSec: int(process.env.SOLD_OUT_FLAG_TTL_SEC, 60),
  maxQtyPerItem: int(process.env.MAX_QTY_PER_ITEM, 5),
  rateLimit: {
    windowSec: int(process.env.RATE_LIMIT_WINDOW_SEC, 60),
    max: int(process.env.RATE_LIMIT_MAX, 30),
  },
};

export default config;
