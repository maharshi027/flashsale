const request = require('supertest');
const app = require('../src/app');
const { pool } = require('../src/db');
const { redis, connectRedis } = require('../src/redis');
const { migrate } = require('../scripts/migrate');

const ADMIN = { 'X-Admin-Key': 'test-admin-key' };

async function setup() {
  await migrate();
  await connectRedis();
}

async function reset() {
  await pool.query(
    'TRUNCATE users, products, cart_items, orders, order_items, idempotency_keys RESTART IDENTITY CASCADE'
  );
  if (redis.status === 'ready') await redis.flushdb();
}

async function teardown() {
  await pool.end();
  await redis.quit().catch(() => {});
}

const createProduct = async (stock, extra = {}) =>
  (await request(app).post('/products').set(ADMIN).send({ name: 'Item', priceCents: 1000, stock, ...extra })).body;

const createUser = async (n) =>
  (await request(app).post('/users').send({ name: `User ${n}`, email: `u${n}@example.com` })).body;

const addToCart = (userId, productId, quantity = 1) =>
  request(app).put(`/cart/items/${productId}`).set('X-User-Id', userId).send({ quantity });

const checkout = (userId, key) =>
  request(app).post('/checkout').set('X-User-Id', userId).set('Idempotency-Key', key);

const audit = async (productId) =>
  (await request(app).get(`/admin/products/${productId}/audit`).set(ADMIN)).body;

module.exports = { app, ADMIN, setup, reset, teardown, createProduct, createUser, addToCart, checkout, audit, request };
