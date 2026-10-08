const express = require('express');
const { pool } = require('../db');
const { cache } = require('../redis');
const { wrap } = require('../middleware/errorHandler');
const { requireUser, requireAdmin } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');
const { AppError } = require('../errors');
const { positiveInt, nonEmptyString } = require('../validate');
const productService = require('../services/productService');
const cartService = require('../services/cartService');
const orderService = require('../services/orderService');

const router = express.Router();

// ---------- health ----------
router.get(
  '/health',
  wrap(async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', postgres: 'up', redis: cache.isUp() ? 'up' : 'down (running degraded)' });
  })
);

// ---------- users ----------
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

module.exports = router;
