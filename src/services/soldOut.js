const config = require('../config');
const { cache } = require('../redis');

/**
 * "Sold-out" flags in Redis let us reject doomed checkouts WITHOUT touching
 * PostgreSQL. During a flash sale, 99% of requests arrive after the stock is
 * gone - this keeps them off the database and the row locks.
 *
 * It is only an optimisation: flags are short-lived and PostgreSQL still makes
 * the final decision inside the transaction.
 */
const key = (id) => `soldout:${id}`;

async function markSoldOut(productIds) {
  await Promise.all(productIds.map((id) => cache.set(key(id), '1', config.soldOutFlagTtlSec)));
}

async function clear(productIds) {
  await cache.del(...productIds.map(key));
}

async function filterSoldOut(productIds) {
  if (productIds.length === 0) return [];
  const flags = await cache.mget(productIds.map(key));
  return productIds.filter((_, i) => flags[i]);
}

module.exports = { markSoldOut, clear, filterSoldOut };
