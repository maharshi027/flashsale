# Interview notes: questions you should be able to answer

Read `src/services/orderService.js` until you can explain every step without looking.

**1. What problem does this solve, in one sentence?**
It makes sure that when many users buy the last few units at once, stock never goes negative and no order is created twice.

**2. Why would a naive implementation oversell?**
`SELECT stock` → check in JS → `UPDATE stock` is not atomic. Two requests can both read `stock = 1`, both pass the check, and both decrement. That is a *check-then-act race condition*.

**3. How does your code prevent it?**
Inside one transaction I run `SELECT ... FOR UPDATE` on the product rows. The second buyer blocks until the first commits, then re-reads the *new* stock and is rejected. A `CHECK (stock >= 0)` constraint is a backstop.

**4. What is a deadlock and how do you avoid it?**
Buyer A locks product 1 then wants 2; buyer B locks 2 then wants 1, so both wait forever. I always lock rows in ascending id order (`ORDER BY id FOR UPDATE`), so a circular wait is impossible. As a safety net, `withTransaction` retries on Postgres error `40P01`.

**5. Explain idempotency. Why does checkout need it?**
Networks fail and users double-click, so the same request can arrive twice. With an `Idempotency-Key`, the first request claims the key and creates the order; later requests with that key get the *stored response*. The key is inserted inside the checkout transaction, so concurrent duplicates wait on the unique index instead of racing. If checkout fails, the key rolls back and the client can retry.

**6. What are ACID properties, and where do you rely on each?**
Atomicity: stock, order and cart changes commit or roll back together. Consistency: constraints (`CHECK`, foreign keys, unique). Isolation: row locks stop concurrent buyers interfering. Durability: committed orders survive a crash.

**7. Why is Redis here? What happens if it dies?**
Redis only makes things faster and cheaper: caching reads, rate limiting, and sold-out flags that skip the DB. Correctness lives in PostgreSQL, so every Redis helper fails open. Try it yourself: stop Redis while the API runs. `/health` reports `redis: down (running degraded)`, checkout and idempotent replay still work, and the app reconnects automatically when Redis returns.

**8. What are the weaknesses of your cache?**
Cache-aside has a race: a reader can fetch old stock just before a commit and write it to the cache after my invalidation. Mitigations: short TTL (I use 30s), versioned keys, or delayed double-delete. It is acceptable because the cache only shows *approximate* stock and checkout never trusts it.

**9. Where is the bottleneck, and how would you scale to 10x?**
One hot product = one row lock = serialised transactions, so throughput is limited by transaction time. Options: keep transactions short (already minimal), use a single atomic `UPDATE ... WHERE stock >= qty`, pre-allocate stock in Redis with a Lua script, or put a queue (SQS) in front to serialise purchases per product. Read scaling: replicas and CDN caching. Write scaling: shard by product id.

**10. Pessimistic vs optimistic locking?**
Pessimistic (what I used) locks first and is better under high contention, because there are no wasted retries. Optimistic (version column / `UPDATE ... WHERE stock >= qty`) avoids holding locks but retries a lot when contention is high.

**11. Why not reserve stock when the item is added to the cart?**
Bots could hoard stock without paying. Real systems reserve at checkout, or use short-lived reservations with expiry.

**12. How did you test concurrency?**
Real Postgres and Redis in the tests (no mocks), firing 60 parallel requests with `Promise.all`, then asserting exact counts and using an audit query to check `stock + units sold == initial stock`. Do this yourself too: delete `FOR UPDATE` from the product-lock query in `runCheckout`, run `npm test`, and watch the race tests fail (the DB `CHECK` constraint then throws 500s). That proves the tests would catch the bug.

**13. What would you do differently for real payments?**
Never call a payment provider inside a DB transaction (it holds locks while waiting on the network). Create the order as `PENDING`, reserve stock, take payment, then confirm or release on failure with a timeout job (saga pattern).
