import express from 'express';
import { pool } from '../db.js';
import { cache } from '../redis.js';
import { wrap } from '../middleware/errorHandler.js';
import { requireUser, requireAdmin } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { AppError } from '../errors.js';
import { positiveInt, nonEmptyString } from '../validate.js';
import productService from '../services/productService.js';
import cartService from '../services/cartService.js';
import orderService from '../services/orderService.js';

const router = express.Router();

// ---------- health ----------
router.get(
  '/health',
  wrap(async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({
      status: 'ok',
      postgres: 'up',
      redis: cache.isUp() ? 'up' : 'down (running degraded - fail-open active)',
    });
  })
);

// ---------- users ----------
router.get(
  '/users',
  wrap(async (_req, res) => {
    const { rows } = await pool.query('SELECT id, name, email FROM users ORDER BY id ASC LIMIT 50');
    res.json(rows);
  })
);

router.post(
  '/users',
  wrap(async (req, res) => {
    const name = nonEmptyString(req.body.name, 'name');
    const email = nonEmptyString(req.body.email, 'email', 254).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'email is not valid');
    }
    try {
      const { rows } = await pool.query(
        'INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id, name, email',
        [name, email]
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      if (err.code === '23505') throw new AppError(409, 'EMAIL_TAKEN', 'Email already registered');
      throw err;
    }
  })
);

// ---------- products ----------
router.get(
  '/products',
  wrap(async (_req, res) => {
    const { products, cacheHit } = await productService.list();
    res.set('X-Cache', cacheHit ? 'HIT' : 'MISS').json(products);
  })
);

router.get(
  '/products/:id',
  wrap(async (req, res) => {
    const id = positiveInt(req.params.id, 'id');
    const bypassCache = (req.get('Cache-Control') || '').includes('no-cache');
    const { product, cacheHit } = await productService.getById(id, { bypassCache });
    res.set('X-Cache', cacheHit ? 'HIT' : 'MISS').json(product);
  })
);

router.post(
  '/products',
  requireAdmin,
  wrap(async (req, res) => {
    const product = await productService.create({
      name: nonEmptyString(req.body.name, 'name'),
      description: req.body.description ? String(req.body.description).slice(0, 2000) : '',
      priceCents: positiveInt(req.body.priceCents, 'priceCents', { allowZero: true }),
      stock: positiveInt(req.body.stock, 'stock', { allowZero: true }),
    });
    res.status(201).json(product);
  })
);

router.patch(
  '/products/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const id = positiveInt(req.params.id, 'id');
    const patch = {};
    if (req.body.priceCents !== undefined) {
      patch.priceCents = positiveInt(req.body.priceCents, 'priceCents', { allowZero: true });
    }
    if (req.body.stock !== undefined) {
      patch.stock = positiveInt(req.body.stock, 'stock', { allowZero: true });
    }
    res.json(await productService.update(id, patch));
  })
);

router.get(
  '/admin/products/:id/audit',
  requireAdmin,
  wrap(async (req, res) => {
    res.json(await productService.audit(positiveInt(req.params.id, 'id')));
  })
);

router.get(
  '/admin/orders',
  requireAdmin,
  wrap(async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT o.id, o.user_id, u.name as user_name, u.email as user_email, o.status, o.total_cents, o.created_at, o.cancelled_at,
              COALESCE(json_agg(json_build_object('product_id', oi.product_id, 'product_name', oi.product_name, 'unit_price_cents', oi.unit_price_cents, 'quantity', oi.quantity)) FILTER (WHERE oi.id IS NOT NULL), '[]') as items
         FROM orders o
         JOIN users u ON u.id = o.user_id
         LEFT JOIN order_items oi ON oi.order_id = o.id
        GROUP BY o.id, u.name, u.email
        ORDER BY o.created_at DESC LIMIT 50`
    );
    res.json(rows);
  })
);

router.post(
  '/admin/reset',
  requireAdmin,
  wrap(async (_req, res) => {
    await pool.query(
      'TRUNCATE users, products, cart_items, orders, order_items, idempotency_keys RESTART IDENTITY CASCADE'
    );
    if (cache.isUp()) {
      await cache.del('products:list');
    }
    await pool.query(
      `INSERT INTO products (name, description, price_cents, stock) VALUES
        ('Wireless Earbuds Pro', 'Active noise cancelling flash special', 199900, 20),
        ('Smart Watch Ultra', 'Titanium finish & cellular', 349900, 10),
        ('Mechanical Gaming Keyboard', 'RGB Hot-swappable switches', 249900, 5)`
    );
    for (let i = 1; i <= 5; i++) {
      await pool.query(
        'INSERT INTO users (name, email) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [`Demo User ${i}`, `user${i}@example.com`]
      );
    }
    res.json({ message: 'System database reset and seeded successfully' });
  })
);

// ---------- cart ----------
router.get(
  '/cart',
  requireUser,
  wrap(async (req, res) => res.json(await cartService.getCart(req.userId)))
);

router.put(
  '/cart/items/:productId',
  requireUser,
  wrap(async (req, res) => {
    const productId = positiveInt(req.params.productId, 'productId');
    const quantity = positiveInt(req.body.quantity, 'quantity', { allowZero: true, max: 1000 });
    res.json(await cartService.setItem(req.userId, productId, quantity));
  })
);

router.delete(
  '/cart/items/:productId',
  requireUser,
  wrap(async (req, res) => {
    const productId = positiveInt(req.params.productId, 'productId');
    res.json(await cartService.removeItem(req.userId, productId));
  })
);

// ---------- checkout & orders ----------
router.post(
  '/checkout',
  requireUser,
  rateLimit('checkout'),
  wrap(async (req, res) => {
    const key = req.get('Idempotency-Key');
    if (!key || key.length > 255 || !/^[A-Za-z0-9_\-:.]+$/.test(key)) {
      throw new AppError(
        400,
        'IDEMPOTENCY_KEY_REQUIRED',
        'Send a unique Idempotency-Key header (letters, digits, - _ : . ; max 255 chars)'
      );
    }
    const { replay, statusCode, body } = await orderService.checkout(req.userId, key);
    res.set('Idempotent-Replay', String(replay)).status(statusCode).json(body);
  })
);

router.get(
  '/orders',
  requireUser,
  wrap(async (req, res) => res.json(await orderService.listOrders(req.userId)))
);

router.get(
  '/orders/:id',
  requireUser,
  wrap(async (req, res) =>
    res.json(await orderService.getOrder(req.userId, positiveInt(req.params.id, 'id', { max: Number.MAX_SAFE_INTEGER })))
  )
);

router.post(
  '/orders/:id/cancel',
  requireUser,
  rateLimit('cancel'),
  wrap(async (req, res) =>
    res.json(await orderService.cancelOrder(req.userId, positiveInt(req.params.id, 'id', { max: Number.MAX_SAFE_INTEGER })))
  )
);

export default router;
