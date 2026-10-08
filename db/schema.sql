-- Flash-sale order system schema (idempotent: safe to run many times)

CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  price_cents  INTEGER NOT NULL CHECK (price_cents >= 0),
  -- Last line of defence: even if application code has a bug,
  -- the database refuses to let stock go negative (no overselling).
  stock        INTEGER NOT NULL CHECK (stock >= 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cart_items (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity    INTEGER NOT NULL CHECK (quantity > 0),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id               BIGSERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL REFERENCES users(id),
  status           TEXT NOT NULL CHECK (status IN ('CONFIRMED', 'CANCELLED')),
  total_cents      BIGINT NOT NULL CHECK (total_cents >= 0),
  idempotency_key  TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at     TIMESTAMPTZ,
  -- Second safety net: one order per (user, idempotency key), enforced by the DB.
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS orders_user_created_idx ON orders (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS order_items (
  id                BIGSERIAL PRIMARY KEY,
  order_id          BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id        INTEGER NOT NULL REFERENCES products(id),
  product_name      TEXT NOT NULL,          -- snapshot at purchase time
  unit_price_cents  INTEGER NOT NULL,       -- snapshot at purchase time
  quantity          INTEGER NOT NULL CHECK (quantity > 0)
);
CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items (order_id);

-- Stores the result of each successful checkout so retries get the SAME response.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id      INTEGER NOT NULL REFERENCES users(id),
  key          TEXT NOT NULL,
  order_id     BIGINT,
  status_code  INTEGER,
  response     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
