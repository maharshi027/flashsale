import { pool } from '../src/db.js';

export async function seed() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM products');
  if (rows[0].n > 0) {
    console.log('Products already exist - skipping seed');
    return;
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
  console.log('Seeded 3 products and 5 users');
}

export default { seed };

seed()
  .catch((err) => {
    console.error('Seed failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
