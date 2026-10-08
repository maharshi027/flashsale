import h from './helpers.js';
import config from '../src/config.js';
const { request, app } = h;

beforeAll(h.setup);
beforeEach(h.reset);
afterAll(h.teardown);

describe('checkout basics', () => {
  test('happy path: creates order, decrements stock, clears cart', async () => {
    const product = await h.createProduct(5, { priceCents: 2500 });
    const user = await h.createUser(1);
    await h.addToCart(user.id, product.id, 2);

    const res = await h.checkout(user.id, 'key-1');
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('CONFIRMED');
    expect(res.body.totalCents).toBe(5000);
    expect(res.headers['idempotent-replay']).toBe('false');

    const fresh = await request(app).get(`/products/${product.id}`).set('Cache-Control', 'no-cache');
    expect(fresh.body.stock).toBe(3);

    const cart = await request(app).get('/cart').set('X-User-Id', user.id);
    expect(cart.body.items).toHaveLength(0);

    const orders = await request(app).get('/orders').set('X-User-Id', user.id);
    expect(orders.body).toHaveLength(1);
  });

  test('insufficient stock -> 409 and NOTHING changes (rollback)', async () => {
    const product = await h.createProduct(1);
    const user = await h.createUser(1);
    await h.addToCart(user.id, product.id, 1);
    // someone else (admin) reduces stock to zero after the item was added to the cart
    await request(app).patch(`/products/${product.id}`).set(h.ADMIN).send({ stock: 0 });

    const res = await h.checkout(user.id, 'key-1');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');

    const cart = await request(app).get('/cart').set('X-User-Id', user.id);
    expect(cart.body.items).toHaveLength(1); // cart untouched
    expect((await h.audit(product.id)).confirmedOrders).toBe(0);
  });

  test('multi-item cart is all-or-nothing', async () => {
    const a = await h.createProduct(10);
    const b = await h.createProduct(1);
    const user = await h.createUser(1);
    await h.addToCart(user.id, a.id, 3);
    await h.addToCart(user.id, b.id, 1);
    await request(app).patch(`/products/${b.id}`).set(h.ADMIN).send({ stock: 0 });

    const res = await h.checkout(user.id, 'key-1');
    expect(res.status).toBe(409);
    // product A must NOT have been decremented even though it had enough stock
    expect((await h.audit(a.id)).stock).toBe(10);
  });

  test('empty cart -> 400; missing / invalid Idempotency-Key -> 400; no user header -> 401', async () => {
    const user = await h.createUser(1);
    expect((await h.checkout(user.id, 'k1')).body.error.code).toBe('EMPTY_CART');

    const noKey = await request(app).post('/checkout').set('X-User-Id', user.id);
    expect(noKey.status).toBe(400);
    expect(noKey.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');

    const noUser = await request(app).post('/checkout').set('Idempotency-Key', 'k');
    expect(noUser.status).toBe(401);
  });

  test('per-customer purchase limit is enforced', async () => {
    const product = await h.createProduct(50);
    const user = await h.createUser(1);
    const res = await h.addToCart(user.id, product.id, 6);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('LIMIT_EXCEEDED');
  });
});

describe('concurrency: the flash sale', () => {
  test('60 buyers race for 10 units -> exactly 10 succeed, stock ends at 0, never oversold', async () => {
    const STOCK = 10;
    const BUYERS = 60;
    const product = await h.createProduct(STOCK);
    const users = [];
    for (let i = 1; i <= BUYERS; i++) users.push(await h.createUser(i));
    await Promise.all(users.map((u) => h.addToCart(u.id, product.id, 1)));

    const results = await Promise.all(users.map((u) => h.checkout(u.id, `race-${u.id}`)));

    const ok = results.filter((r) => r.status === 201);
    const rejected = results.filter((r) => r.status === 409);
    expect(ok).toHaveLength(STOCK);
    expect(rejected).toHaveLength(BUYERS - STOCK);
    expect(results.filter((r) => r.status >= 500)).toHaveLength(0);

    const a = await h.audit(product.id);
    expect(a.stock).toBe(0);
    expect(a.confirmedUnits).toBe(STOCK);
    expect(a.stockPlusSold).toBe(STOCK); // the inventory invariant holds
  });

  test('buyers with 2-unit carts: units sold never exceed stock', async () => {
    const product = await h.createProduct(7);
    const users = [];
    for (let i = 1; i <= 20; i++) users.push(await h.createUser(i));
    await Promise.all(users.map((u) => h.addToCart(u.id, product.id, 2)));

    const results = await Promise.all(users.map((u) => h.checkout(u.id, `k-${u.id}`)));
    expect(results.filter((r) => r.status >= 500)).toHaveLength(0);

    const a = await h.audit(product.id);
    expect(a.confirmedUnits).toBeLessThanOrEqual(7);
    expect(a.stock).toBeGreaterThanOrEqual(0);
    expect(a.stockPlusSold).toBe(7);
    expect(results.filter((r) => r.status === 201)).toHaveLength(3); // 3 x 2 = 6 units
  });

  test('no deadlocks: carts with the same items in different insertion order', async () => {
    const a = await h.createProduct(100);
    const b = await h.createProduct(100);
    const users = [];
    for (let i = 1; i <= 30; i++) users.push(await h.createUser(i));
    // odd users add A then B; even users add B then A
    for (const u of users) {
      if (u.id % 2) {
        await h.addToCart(u.id, a.id, 1);
        await h.addToCart(u.id, b.id, 1);
      } else {
        await h.addToCart(u.id, b.id, 1);
        await h.addToCart(u.id, a.id, 1);
      }
    }
    const results = await Promise.all(users.map((u) => h.checkout(u.id, `k-${u.id}`)));
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect((await h.audit(a.id)).stock).toBe(70);
    expect((await h.audit(b.id)).stock).toBe(70);
  });
});

describe('idempotency', () => {
  test('8 parallel requests with the SAME key create exactly ONE order', async () => {
    const product = await h.createProduct(10);
    const user = await h.createUser(1);
    await h.addToCart(user.id, product.id, 2);

    const results = await Promise.all(Array.from({ length: 8 }, () => h.checkout(user.id, 'same-key')));

    expect(results.every((r) => r.status === 201)).toBe(true);
    const orderIds = new Set(results.map((r) => r.body.orderId));
    expect(orderIds.size).toBe(1);
    expect(results.filter((r) => r.headers['idempotent-replay'] === 'false')).toHaveLength(1);

    const a = await h.audit(product.id);
    expect(a.confirmedOrders).toBe(1);
    expect(a.stock).toBe(8); // decremented once, not 8 times
  });

  test('a later retry with the same key replays the original response', async () => {
    const product = await h.createProduct(10);
    const user = await h.createUser(1);
    await h.addToCart(user.id, product.id, 1);

    const first = await h.checkout(user.id, 'retry-key');
    const retry = await h.checkout(user.id, 'retry-key');
    expect(retry.status).toBe(201);
    expect(retry.headers['idempotent-replay']).toBe('true');
    expect(retry.body).toEqual(first.body);
    expect((await h.audit(product.id)).stock).toBe(9);
  });

  test('a FAILED checkout does not burn the key - client can retry after fixing the problem', async () => {
    const product = await h.createProduct(0);
    const user = await h.createUser(1);
    await h.addToCart(user.id, product.id, 1).catch(() => {});
    expect((await h.checkout(user.id, 'k')).status).toBe(400); // empty cart (add was rejected)

    await request(app).patch(`/products/${product.id}`).set(h.ADMIN).send({ stock: 3 });
    await h.addToCart(user.id, product.id, 1);
    expect((await h.checkout(user.id, 'k')).status).toBe(201);
  });
});

describe('cancellation', () => {
  async function placeOrder() {
    const product = await h.createProduct(5);
    const user = await h.createUser(1);
    await h.addToCart(user.id, product.id, 2);
    const order = (await h.checkout(user.id, 'k')).body;
    return { product, user, order };
  }

  test('cancel restores stock and cannot be cancelled twice', async () => {
    const { product, user, order } = await placeOrder();
    expect((await h.audit(product.id)).stock).toBe(3);

    const cancel = await request(app).post(`/orders/${order.orderId}/cancel`).set('X-User-Id', user.id);
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe('CANCELLED');
    expect((await h.audit(product.id)).stock).toBe(5);

    const again = await request(app).post(`/orders/${order.orderId}/cancel`).set('X-User-Id', user.id);
    expect(again.status).toBe(409);
    expect((await h.audit(product.id)).stock).toBe(5); // not restocked twice
  });

  test('5 concurrent cancels restock exactly once', async () => {
    const { product, user, order } = await placeOrder();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app).post(`/orders/${order.orderId}/cancel`).set('X-User-Id', user.id)
      )
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect((await h.audit(product.id)).stock).toBe(5);
  });

  test("users cannot see or cancel someone else's order", async () => {
    const { order } = await placeOrder();
    const other = await h.createUser(2);
    expect((await request(app).get(`/orders/${order.orderId}`).set('X-User-Id', other.id)).status).toBe(404);
    expect((await request(app).post(`/orders/${order.orderId}/cancel`).set('X-User-Id', other.id)).status).toBe(404);
  });
});

describe('redis layer', () => {
  test('product reads are cached and invalidated by a purchase', async () => {
    const product = await h.createProduct(5);
    const user = await h.createUser(1);
    const miss = await request(app).get(`/products/${product.id}`);
    const hit = await request(app).get(`/products/${product.id}`);
    expect(miss.headers['x-cache']).toBe('MISS');
    expect(hit.headers['x-cache']).toBe('HIT');

    await h.addToCart(user.id, product.id, 1);
    await h.checkout(user.id, 'k');
    const after = await request(app).get(`/products/${product.id}`);
    expect(after.headers['x-cache']).toBe('MISS'); // cache was invalidated
    expect(after.body.stock).toBe(4);
  });

  test('once sold out, later checkouts are rejected from Redis (SOLD_OUT) without a stock lock', async () => {
    const product = await h.createProduct(1);
    const [u1, u2] = [await h.createUser(1), await h.createUser(2)];
    await h.addToCart(u1.id, product.id, 1);
    await h.addToCart(u2.id, product.id, 1);

    expect((await h.checkout(u1.id, 'a')).status).toBe(201);
    const late = await h.checkout(u2.id, 'b');
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('SOLD_OUT');

    // restocking clears the flag
    await request(app).patch(`/products/${product.id}`).set(h.ADMIN).send({ stock: 5 });
    expect((await h.checkout(u2.id, 'c')).status).toBe(201);
  });

  test('rate limiter returns 429 after too many checkout attempts', async () => {
    const original = config.rateLimit.max;
    config.rateLimit.max = 3;
    try {
      const user = await h.createUser(1);
      const codes = [];
      for (let i = 0; i < 5; i++) codes.push((await h.checkout(user.id, `k${i}`)).status);
      expect(codes.slice(0, 3)).toEqual([400, 400, 400]); // empty cart, but allowed through
      expect(codes.slice(3)).toEqual([429, 429]);
    } finally {
      config.rateLimit.max = original;
    }
  });
});

describe('admin & validation', () => {
  test('admin endpoints require the key', async () => {
    const res = await request(app).post('/products').send({ name: 'x', priceCents: 1, stock: 1 });
    expect(res.status).toBe(403);
  });

  test('rejects invalid product input', async () => {
    const res = await request(app).post('/products').set(h.ADMIN).send({ name: 'x', priceCents: -5, stock: 1 });
    expect(res.status).toBe(400);
  });
});
