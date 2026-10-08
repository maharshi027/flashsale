const fs = require('fs');
const path = require('path');
const { pool } = require('../src/db');

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await pool.query(sql);
}

module.exports = { migrate };

if (require.main === module) {
  migrate()
    .then(() => console.log('Migration complete'))
    .catch((err) => {
      console.error('Migration failed:', err.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
