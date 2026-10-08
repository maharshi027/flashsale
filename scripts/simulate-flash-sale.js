import 'dotenv/config';

/**
 * Flash-sale simulator.
 *   npm run simulate                       (defaults: 500 buyers, 50 units)
 *   BUYERS=1000 STOCK=100 DUP_RATE=0.3 npm run simulate
 *
 * Needs the API running (npm start) and Node 18+.
 * Every buyer: add 1 unit to cart -> checkout. DUP_RATE of buyers "double-click"
 * (send the same checkout twice with the same Idempotency-Key, in parallel).
 * At the end it AUDITS the database and prints whether the invariants held.
 * The numbers it prints are the ones to put on your resume (measured on YOUR machine).
 */
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const ADMIN_KEY = process.env.ADMIN_API_KEY || 'dev-admin-key';
const BUYERS = parseInt(process.env.BUYERS || '500', 10);
const STOCK = parseInt(process.env.STOCK || '50', 10);
const DUP_RATE = parseFloat(process.env.DUP_RATE || '0.2');

async function api(method, path, { headers = {}, body } = {}) {
  const t0 = performance.now();
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json, ms: performance.now() - t0, headers: res.headers };
}

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

export async function runSimulation(options = {}) {
  const buyersCount = options.buyers || BUYERS;
  const stockCount = options.stock || STOCK;
  const dupRate = options.dupRate !== undefined ? options.dupRate : DUP_RATE;

  console.log(`Flash sale: ${buyersCount} buyers racing for ${stockCount} units (duplicate-click rate ${dupRate * 100}%)\n`);
  const run = Date.now();

  const product = (
    await api('POST', '/products', {
      headers: { 'X-Admin-Key': ADMIN_KEY },
      body: { name: `Flash Item ${run}`, priceCents: 9900, stock: stockCount },
    })
  ).json;
  if (!product.id) throw new Error('Could not create product - is the API running? ' + JSON.stringify(product));

  // Setup: create users and fill carts (not part of the measured phase)
  const users = await Promise.all(
    Array.from({ length: buyersCount }, (_, i) =>
      api('POST', '/users', { body: { name: `Sim ${i}`, email: `sim-${run}-${i}@example.com` } }).then((r) => r.json)
    )
  );
  await Promise.all(
    users.map((u) =>
      api('PUT', `/cart/items/${product.id}`, { headers: { 'X-User-Id': String(u.id) }, body: { quantity: 1 } })
    )
  );

  // The sale: everyone hits checkout at the same moment
  const t0 = performance.now();
  const attempts = [];
  for (const u of users) {
    const key = `sim-${run}-${u.id}`;
    const send = () => api('POST', '/checkout', { headers: { 'X-User-Id': String(u.id), 'Idempotency-Key': key } });
    attempts.push(send());
    if (Math.random() < dupRate) attempts.push(send()); // the impatient double-click
  }
  const results = await Promise.all(attempts);
  const elapsedSec = (performance.now() - t0) / 1000;

  const count = (fn) => results.filter(fn).length;
  const created = count((r) => r.status === 201 && r.headers.get('idempotent-replay') === 'false');
  const replays = count((r) => r.status === 201 && r.headers.get('idempotent-replay') === 'true');
  const soldOut = count((r) => r.status === 409);
  const limited = count((r) => r.status === 429);
  const errors = count((r) => r.status >= 500);
  const lat = results.map((r) => r.ms).sort((a, b) => a - b);

  const audit = (await api('GET', `/admin/products/${product.id}/audit`, { headers: { 'X-Admin-Key': ADMIN_KEY } })).json;

  console.log('--- Results ---------------------------------------------');
  console.log(`Total checkout requests : ${results.length}`);
  console.log(`New orders created      : ${created}`);
  console.log(`Idempotent replays      : ${replays}  (duplicate clicks safely absorbed)`);
  console.log(`Rejected (sold out)     : ${soldOut}`);
  console.log(`Rate limited (429)      : ${limited}`);
  console.log(`Server errors (5xx)     : ${errors}`);
  console.log(`Throughput              : ${(results.length / elapsedSec).toFixed(0)} req/s over ${elapsedSec.toFixed(2)}s`);
  console.log(`Latency p50 / p95 / p99 : ${percentile(lat, 50).toFixed(0)} / ${percentile(lat, 95).toFixed(0)} / ${percentile(lat, 99).toFixed(0)} ms`);
  console.log('\n--- Database audit --------------------------------------');
  console.log(`Initial stock           : ${stockCount}`);
  console.log(`Stock remaining         : ${audit.stock}`);
  console.log(`Units sold (CONFIRMED)  : ${audit.confirmedUnits}`);
  console.log(`Confirmed orders        : ${audit.confirmedOrders}`);

  const oversold = audit.confirmedUnits > stockCount || audit.stock < 0;
  const consistent = audit.stock + audit.confirmedUnits === stockCount;
  const noDupes = audit.confirmedOrders === created;
  console.log(`\nOversold?               : ${oversold ? 'YES  <-- BUG' : 'NO'}`);
  console.log(`Stock + sold == initial : ${consistent ? 'yes' : 'NO  <-- BUG'}`);
  console.log(`1 order per buyer       : ${noDupes ? 'yes' : 'NO  <-- BUG'}`);
  
  const hasFailed = oversold || !consistent || !noDupes || errors > 0;
  if (hasFailed) process.exitCode = 1;

  return {
    product,
    totalRequests: results.length,
    created,
    replays,
    soldOut,
    limited,
    errors,
    elapsedSec,
    throughput: Math.round(results.length / elapsedSec),
    p50: percentile(lat, 50),
    p95: percentile(lat, 95),
    p99: percentile(lat, 99),
    audit,
    oversold,
    consistent,
    noDupes,
  };
}

runSimulation().catch((e) => {
  console.error(e);
  process.exit(1);
});
