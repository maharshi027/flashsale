import config from '../config.js';
import { pool } from '../db.js';
import { cache } from '../redis.js';
import { AppError } from '../errors.js';
import soldOut from './soldOut.js';

const toDto = (r) => ({
  id: r.id,
  name: r.name,
  description: r.description,
  priceCents: r.price_cents,
  stock: r.stock,
});

const productKey = (id) => `product:${id}`;
const LIST_KEY = 'products:list';

export async function invalidate(productIds) {
  await cache.del(LIST_KEY, ...productIds.map(productKey));
}

export async function create({ name, description, priceCents, stock }) {
  const { rows } = await pool.query(
    `INSERT INTO products (name, description, price_cents, stock)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [name, description || '', priceCents, stock]
  );
  await invalidate([]);
  return toDto(rows[0]);
}

/** Admin update (price and/or stock). Restocking also clears the sold-out flag. */
export async function update(id, { priceCents, stock }) {
  const { rows } = await pool.query(
    `UPDATE products
        SET price_cents = COALESCE($2, price_cents),
            stock       = COALESCE($3, stock),
            updated_at  = now()
      WHERE id = $1 RETURNING *`,
    [id, priceCents ?? null, stock ?? null]
  );
  if (rows.length === 0) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
  await invalidate([id]);
  if (rows[0].stock > 0) await soldOut.clear([id]);
  return toDto(rows[0]);
}

/** Cache-aside read. Returns { product, cacheHit }. Stock shown here is approximate. */
export async function getById(id, { bypassCache = false } = {}) {
  if (!bypassCache) {
    const cached = await cache.getJson(productKey(id));
    if (cached) return { product: cached, cacheHit: true };
  }
  const { rows } = await pool.query('SELECT * FROM products WHERE id = $1', [id]);
  if (rows.length === 0) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
  const product = toDto(rows[0]);
  await cache.setJson(productKey(id), product, config.productCacheTtlSec);
  return { product, cacheHit: false };
}

export async function list() {
  const cached = await cache.getJson(LIST_KEY);
  if (cached) return { products: cached, cacheHit: true };
  const { rows } = await pool.query('SELECT * FROM products ORDER BY id');
  const products = rows.map(toDto);
  await cache.setJson(LIST_KEY, products, Math.min(config.productCacheTtlSec, 5));
  return { products, cacheHit: false };
}

/** Admin audit: lets you PROVE the inventory invariant after a load test. */
export async function audit(id) {
  const { rows } = await pool.query(
    `SELECT p.id, p.stock,
            COALESCE(SUM(oi.quantity) FILTER (WHERE o.status = 'CONFIRMED'), 0)::int AS confirmed_units,
            COUNT(DISTINCT o.id) FILTER (WHERE o.status = 'CONFIRMED')::int          AS confirmed_orders
       FROM products p
       LEFT JOIN order_items oi ON oi.product_id = p.id
       LEFT JOIN orders o       ON o.id = oi.order_id
      WHERE p.id = $1
      GROUP BY p.id`,
    [id]
  );
  if (rows.length === 0) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
  const r = rows[0];
  return {
    productId: r.id,
    stock: r.stock,
    confirmedUnits: r.confirmed_units,
    confirmedOrders: r.confirmed_orders,
    // initialStock should always equal stock + confirmedUnits (if nothing was restocked)
    stockPlusSold: r.stock + r.confirmed_units,
  };
}

export default { create, update, getById, list, audit, invalidate };
