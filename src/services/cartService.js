const config = require('../config');
const { pool } = require('../db');
const { AppError } = require('../errors');
const soldOut = require('./soldOut');

async function getCart(userId) {
  const { rows } = await pool.query(
    `SELECT ci.product_id, ci.quantity, p.name, p.price_cents, p.stock
       FROM cart_items ci JOIN products p ON p.id = ci.product_id
      WHERE ci.user_id = $1 ORDER BY ci.product_id`,
    [userId]
  );
  const items = rows.map((r) => ({
    productId: r.product_id,
    name: r.name,
    quantity: r.quantity,
    unitPriceCents: r.price_cents,
    lineTotalCents: r.price_cents * r.quantity,
    inStock: r.stock >= r.quantity,
  }));
  return { items, totalCents: items.reduce((s, i) => s + i.lineTotalCents, 0) };
}

/**
 * Sets the quantity of a product in the cart (0 removes it).
 * NOTE: adding to a cart does NOT reserve stock - only checkout does.
 * This is the standard e-commerce trade-off (reserving on add-to-cart lets bots hoard stock).
 */
async function setItem(userId, productId, quantity) {
  if (quantity === 0) return removeItem(userId, productId);
  if (quantity > config.maxQtyPerItem) {
    throw new AppError(400, 'LIMIT_EXCEEDED', `Max ${config.maxQtyPerItem} units per product per customer`);
  }
  if ((await soldOut.filterSoldOut([productId])).length) {
    throw new AppError(409, 'SOLD_OUT', 'Product is sold out');
  }
  const { rows } = await pool.query('SELECT stock FROM products WHERE id = $1', [productId]);
  if (rows.length === 0) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
  if (rows[0].stock < quantity) {
    throw new AppError(409, 'INSUFFICIENT_STOCK', `Only ${rows[0].stock} unit(s) available`);
  }
  try {
    await pool.query(
      `INSERT INTO cart_items (user_id, product_id, quantity) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, product_id)
       DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now()`,
      [userId, productId, quantity]
    );
  } catch (err) {
    if (err.code === '23503') throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    throw err;
  }
  return getCart(userId);
}

async function removeItem(userId, productId) {
  await pool.query('DELETE FROM cart_items WHERE user_id = $1 AND product_id = $2', [userId, productId]);
  return getCart(userId);
}

module.exports = { getCart, setItem, removeItem };
