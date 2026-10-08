import request from 'supertest';
import app from '../src/app.js';
import { pool } from '../src/db.js';
import { redis, connectRedis, cache } from '../src/redis.js';
import { migrate } from '../scripts/migrate.js';

export const ADMIN = { 'X-Admin-Key': 'test-admin-key' };

export async function setup() {
  await migrate();
  await connectRedis();
}

export async function reset() {
  await pool.query(
    'TRUNCATE users, products, cart_items, orders, order_items, idempotency_keys RESTART IDENTITY CASCADE'
  );
  if (redis.status === 'ready') {
    await redis.flushdb();
  } else {
    cache.flush();
  }
}

export async function teardown() {
  await pool.end();
  cache.flush();
  if (redis.status === 'ready') {
    await redis.quit().catch(() => {});
  } else {
    redis.disconnect();
  }
}

export const createProduct = async (stock, extra = {}) =>
  (await request(app).post('/products').set(ADMIN).send({ name: 'Item', priceCents: 1000, stock, ...extra })).body;

export const createUser = async (n) =>
  (await request(app).post('/users').send({ name: `User ${n}`, email: `u${n}@example.com` })).body;

export const addToCart = (userId, productId, quantity = 1) =>
  request(app).put(`/cart/items/${productId}`).set('X-User-Id', userId).send({ quantity });

export const checkout = (userId, key) =>
  request(app).post('/checkout').set('X-User-Id', userId).set('Idempotency-Key', key);

export const audit = async (productId) =>
  (await request(app).get(`/admin/products/${productId}/audit`).set(ADMIN)).body;

export { app, request };
export default { app, ADMIN, setup, reset, teardown, createProduct, createUser, addToCart, checkout, audit, request };
