const { pool } = require('../src/db');

async function seed() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM products');
  if (rows[0].n > 0) return console.log('Products already exist - skipping seed');

  await pool.query(
    `INSERT INTO products (name, description, price_cents, stock) VALUES
      ('Wireless Earbuds',  'Flash-sale special', 199900, 20),
      ('Smart Watch',       'Flash-sale special', 349900, 10),
      ('Mechanical Keyboard','Flash-sale special', 249900, 5)`
  );
  for (let i = 1; i <= 5; i++) {
    await pool.query(
      'INSERT INTO users (name, email) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [`Demo User ${i}`, `user${i}@example.com`]
    );
  }
  console.log('Seeded 3 products and 5 users');
}

seed()
  .catch((err) => {
    console.error('Seed failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
