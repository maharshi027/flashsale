const { pool, withTransaction } = require('../db');
const { AppError } = require('../errors');
const soldOut = require('./soldOut');
const productService = require('./productService');

/**
 * CHECKOUT - the heart of the project.
 *
 * Guarantees:
 *  1. NO OVERSELLING  : product rows are locked with SELECT ... FOR UPDATE, so
 *                       concurrent buyers of the same product are serialised.
 *                       (A CHECK (stock >= 0) constraint is the final safety net.)
 *  2. ALL-OR-NOTHING  : stock decrement + order + order items + cart clearing
 *                       happen in ONE transaction. Any failure rolls everything back.
 *  3. NO DEADLOCKS    : rows are always locked in ascending product-id order,
 *                       so two carts with the same items can never lock in opposite order.
 *  4. IDEMPOTENT      : the same (user, Idempotency-Key) can never create two orders.
 *                       Retries / double-clicks / network timeouts get the original response.
 */
async function checkout(userId, idempotencyKey) {
  // Cheap pre-check (Redis only): skip the DB entirely if an item is already known to be sold out.
  const { rows: preCart } = await pool.query(
    'SELECT product_id FROM cart_items WHERE user_id = $1',
    [userId]
  );
  const known = await soldOut.filterSoldOut(preCart.map((r) => r.product_id));
  if (known.length > 0) {
    throw new AppError(409, 'SOLD_OUT', 'One or more items are sold out', { productIds: known });
  }

  let result;
  try {
    result = await withTransaction((client) => runCheckout(client, userId, idempotencyKey));
  } catch (err) {
    if (err.code === '23503') throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    throw err;
  }

  if (!result.replay) {
    // After COMMIT: refresh caches and flag products that just hit zero.
    await productService.invalidate(result.productIds);
    if (result.nowSoldOut.length > 0) await soldOut.markSoldOut(result.nowSoldOut);
  }
  return { replay: result.replay, statusCode: result.statusCode, body: result.body };
}

async function runCheckout(client, userId, idempotencyKey) {
  // 1) IDEMPOTENCY: claim the key. If another request with the same key is still
  //    running, this INSERT *waits* on the unique index until that transaction
  //    commits or rolls back - so duplicates can never run concurrently.
  const claim = await client.query(
    `INSERT INTO idempotency_keys (user_id, key) VALUES ($1, $2)
     ON CONFLICT (user_id, key) DO NOTHING RETURNING key`,
    [userId, idempotencyKey]
  );
  if (claim.rowCount === 0) {
    const { rows } = await client.query(
      'SELECT status_code, response FROM idempotency_keys WHERE user_id = $1 AND key = $2',
      [userId, idempotencyKey]
    );
    return { replay: true, statusCode: rows[0].status_code, body: rows[0].response };
  }

  // 2) Read the cart.
  const { rows: cart } = await client.query(
    'SELECT product_id, quantity FROM cart_items WHERE user_id = $1 ORDER BY product_id',
    [userId]
  );
  if (cart.length === 0) throw new AppError(400, 'EMPTY_CART', 'Your cart is empty');
  const ids = cart.map((c) => c.product_id);

  // 3) Lock the product rows in a consistent order (prevents deadlocks).
  const { rows: products } = await client.query(
    `SELECT id, name, price_cents, stock FROM products
      WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE`,
    [ids]
  );
  if (products.length !== cart.length) {
    throw new AppError(409, 'PRODUCT_UNAVAILABLE', 'A product in your cart is no longer available');
  }

  // 4) Validate stock while holding the locks - this check cannot be raced.
  const shortages = [];
  const lines = cart.map((c, i) => {
    const p = products[i]; // both lists are ordered by product id
    if (p.stock < c.quantity) {
      shortages.push({ productId: p.id, requested: c.quantity, available: p.stock });
    }
    return { product: p, quantity: c.quantity };
  });
  if (shortages.length > 0) {
    throw new AppError(409, 'INSUFFICIENT_STOCK', 'Not enough stock for some items', { shortages });
  }

  // 5) Decrement stock.
  const { rows: updated } = await client.query(
    `UPDATE products p SET stock = p.stock - v.qty, updated_at = now()
       FROM unnest($1::int[], $2::int[]) AS v(id, qty)
      WHERE p.id = v.id RETURNING p.id, p.stock`,
    [lines.map((l) => l.product.id), lines.map((l) => l.quantity)]
  );
  const nowSoldOut = updated.filter((r) => r.stock === 0).map((r) => r.id);

  // 6) Create the order and its items (prices are snapshotted).
  const totalCents = lines.reduce((s, l) => s + l.product.price_cents * l.quantity, 0);
  const { rows: orderRows } = await client.query(
    `INSERT INTO orders (user_id, status, total_cents, idempotency_key)
     VALUES ($1, 'CONFIRMED', $2, $3) RETURNING id`,
    [userId, totalCents, idempotencyKey]
  );
  const orderId = orderRows[0].id;
  await client.query(
    `INSERT INTO order_items (order_id, product_id, product_name, unit_price_cents, quantity)
     SELECT $1, v.id, v.name, v.price, v.qty
       FROM unnest($2::int[], $3::text[], $4::int[], $5::int[]) AS v(id, name, price, qty)`,
    [
      orderId,
      lines.map((l) => l.product.id),
      lines.map((l) => l.product.name),
      lines.map((l) => l.product.price_cents),
      lines.map((l) => l.quantity),
    ]
  );

  // 7) Clear the cart.
  await client.query('DELETE FROM cart_items WHERE user_id = $1', [userId]);

  // 8) Save the response under the idempotency key (same transaction => atomic).
  const body = {
    orderId,
    status: 'CONFIRMED',
    totalCents,
    items: lines.map((l) => ({
      productId: l.product.id,
      name: l.product.name,
      quantity: l.quantity,
      unitPriceCents: l.product.price_cents,
    })),
  };
  await client.query(
    `UPDATE idempotency_keys SET order_id = $3, status_code = 201, response = $4
      WHERE user_id = $1 AND key = $2`,
    [userId, idempotencyKey, orderId, JSON.stringify(body)]
  );

  return { replay: false, statusCode: 201, body, productIds: ids, nowSoldOut };
}

async function listOrders(userId) {
  const { rows } = await pool.query(
    `SELECT id, status, total_cents, created_at FROM orders
      WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 50`,
    [userId]
  );
  return rows.map((r) => ({
    orderId: r.id,
    status: r.status,
    totalCents: r.total_cents,
    createdAt: r.created_at,
  }));
}

async function getOrder(userId, orderId) {
  const { rows } = await pool.query(
    'SELECT id, status, total_cents, created_at, cancelled_at FROM orders WHERE id = $1 AND user_id = $2',
    [orderId, userId]
  );
  if (rows.length === 0) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
  const { rows: items } = await pool.query(
    `SELECT product_id, product_name, unit_price_cents, quantity
       FROM order_items WHERE order_id = $1 ORDER BY product_id`,
    [orderId]
  );
  const o = rows[0];
  return {
    orderId: o.id,
    status: o.status,
    totalCents: o.total_cents,
    createdAt: o.created_at,
    cancelledAt: o.cancelled_at,
    items: items.map((i) => ({
      productId: i.product_id,
      name: i.product_name,
      quantity: i.quantity,
      unitPriceCents: i.unit_price_cents,
    })),
  };
}

/**
 * Cancels an order and returns the units to stock - atomically.
 * Locking the ORDER row first means two concurrent cancels cannot both restock.
 */
async function cancelOrder(userId, orderId) {
  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(
      'SELECT id, status FROM orders WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [orderId, userId]
    );
    if (rows.length === 0) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
    if (rows[0].status !== 'CONFIRMED') {
      throw new AppError(409, 'NOT_CANCELLABLE', `Order is already ${rows[0].status}`);
    }
    const { rows: items } = await client.query(
      'SELECT product_id, quantity FROM order_items WHERE order_id = $1 ORDER BY product_id',
      [orderId]
    );
    const ids = items.map((i) => i.product_id);
    // Lock products in id order (same order as checkout) before updating.
    await client.query('SELECT id FROM products WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE', [ids]);
    await client.query(
      `UPDATE products p SET stock = p.stock + v.qty, updated_at = now()
         FROM unnest($1::int[], $2::int[]) AS v(id, qty) WHERE p.id = v.id`,
      [ids, items.map((i) => i.quantity)]
    );
    await client.query(
      "UPDATE orders SET status = 'CANCELLED', cancelled_at = now() WHERE id = $1",
      [orderId]
    );
    return { productIds: ids };
  });

  await productService.invalidate(result.productIds);
  await soldOut.clear(result.productIds);
  return getOrder(userId, orderId);
}

module.exports = { checkout, listOrders, getOrder, cancelOrder };
