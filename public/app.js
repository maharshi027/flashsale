/**
 * FlashSale Engine - Client Application & Simulation Lab
 */

// --- State ---
const state = {
  currentUserId: 1,
  adminKey: 'dev-admin-key',
  products: [],
  cart: { items: [], totalCents: 0 },
  users: [],
  activeTab: 'tab-storefront',
  selectedAdminProductId: null,
};

// --- DOM References ---
const els = {
  pgStatusVal: document.getElementById('pg-status-val'),
  redisStatusVal: document.getElementById('redis-status-val'),
  pillPg: document.getElementById('pill-pg'),
  pillRedis: document.getElementById('pill-redis'),
  userSelect: document.getElementById('active-user-select'),
  btnNewUser: document.getElementById('btn-new-user'),
  btnOpenCart: document.getElementById('btn-open-cart'),
  cartBadge: document.getElementById('cart-badge'),
  btnQuickReset: document.getElementById('btn-quick-reset'),
  productsList: document.getElementById('products-list'),
  btnRefreshProducts: document.getElementById('btn-refresh-products'),
  cartSummaryBox: document.getElementById('cart-summary-box'),
  cartBuyerName: document.getElementById('cart-buyer-name'),
  cartItemsContainer: document.getElementById('cart-items-container'),
  cartTotalDisplay: document.getElementById('cart-total-display'),
  btnClearCart: document.getElementById('btn-clear-cart'),
  inputIdempotencyKey: document.getElementById('input-idempotency-key'),
  btnGenKey: document.getElementById('btn-gen-key'),
  btnCheckoutSingle: document.getElementById('btn-checkout-single'),
  btnCheckoutDouble: document.getElementById('btn-checkout-double'),
  checkoutResultBox: document.getElementById('checkout-result-box'),
  resultBadge: document.getElementById('result-badge'),
  resultTiming: document.getElementById('result-timing'),
  resultDetailsText: document.getElementById('result-details-text'),
  // Simulator
  simBuyersCount: document.getElementById('sim-buyers-count'),
  simBuyersVal: document.getElementById('sim-buyers-val'),
  simStockCount: document.getElementById('sim-stock-count'),
  simStockVal: document.getElementById('sim-stock-val'),
  simDupRate: document.getElementById('sim-dup-rate'),
  simDupVal: document.getElementById('sim-dup-val'),
  btnRunSimulation: document.getElementById('btn-run-simulation'),
  simProgressWrapper: document.getElementById('sim-progress-wrapper'),
  simProgressStatus: document.getElementById('sim-progress-status'),
  simProgressPct: document.getElementById('sim-progress-pct'),
  simProgressBar: document.getElementById('sim-progress-bar'),
  simResultsContainer: document.getElementById('sim-results-container'),
  simInvariantCard: document.getElementById('sim-invariant-card'),
  invariantIcon: document.getElementById('invariant-icon'),
  invariantStatusTitle: document.getElementById('invariant-status-title'),
  invariantMathFormula: document.getElementById('invariant-math-formula'),
  invariantExplanation: document.getElementById('invariant-explanation'),
  statTotalReqs: document.getElementById('stat-total-reqs'),
  statConfirmedOrders: document.getElementById('stat-confirmed-orders'),
  statReplays: document.getElementById('stat-replays'),
  statSoldOut: document.getElementById('stat-sold-out'),
  statLimited: document.getElementById('stat-limited'),
  statErrors: document.getElementById('stat-errors'),
  statThroughput: document.getElementById('stat-throughput'),
  statElapsed: document.getElementById('stat-elapsed'),
  statLatencies: document.getElementById('stat-latencies'),
  // Orders
  userOrdersCount: document.getElementById('user-orders-count'),
  ordersList: document.getElementById('orders-list'),
  btnRefreshOrders: document.getElementById('btn-refresh-orders'),
  // Admin
  adminSelectProduct: document.getElementById('admin-select-product'),
  adminInputStock: document.getElementById('admin-input-stock'),
  adminInputPrice: document.getElementById('admin-input-price'),
  btnAdminUpdateProduct: document.getElementById('btn-admin-update-product'),
  btnRunAudit: document.getElementById('btn-run-audit'),
  auditResultDisplay: document.getElementById('audit-result-display'),
  auditPId: document.getElementById('audit-p-id'),
  auditPStock: document.getElementById('audit-p-stock'),
  auditPSold: document.getElementById('audit-p-sold'),
  auditPOrders: document.getElementById('audit-p-orders'),
  auditPSum: document.getElementById('audit-p-sum'),
  adminOrdersTbody: document.getElementById('admin-orders-tbody'),
  btnRefreshAdminOrders: document.getElementById('btn-refresh-admin-orders'),
  // Terminal
  terminalLog: document.getElementById('terminal-log'),
  btnClearLog: document.getElementById('btn-clear-log'),
  // Tab buttons
  tabBtns: document.querySelectorAll('.tab-btn'),
  tabPanes: document.querySelectorAll('.tab-pane'),
};

// --- Terminal Logger ---
function logEvent(msg, type = 'info') {
  const line = document.createElement('div');
  line.className = `log-line ${type}`;
  const time = new Date().toLocaleTimeString('en-US', { hour12: false });
  line.textContent = `[${time}] ${msg}`;
  els.terminalLog.appendChild(line);
  els.terminalLog.scrollTop = els.terminalLog.scrollHeight;
}

// --- API Client with Logging ---
async function api(path, options = {}) {
  const t0 = performance.now();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const method = options.method || 'GET';

  try {
    const res = await fetch(path, { ...options, headers });
    const ms = (performance.now() - t0).toFixed(1);
    const json = await res.json().catch(() => ({}));
    const cacheHeader = res.headers.get('x-cache');
    const replayHeader = res.headers.get('idempotent-replay');

    let logTag = `[${method}] ${path} → ${res.status} (${ms}ms)`;
    if (cacheHeader) logTag += ` [Cache: ${cacheHeader}]`;
    if (replayHeader) logTag += ` [Replay: ${replayHeader}]`;

    const logType = res.ok ? 'success' : res.status < 500 ? 'warn' : 'error';
    logEvent(logTag, logType);

    return { status: res.status, ok: res.ok, json, headers: res.headers, ms };
  } catch (err) {
    const ms = (performance.now() - t0).toFixed(1);
    logEvent(`[${method}] ${path} FAILED: ${err.message} (${ms}ms)`, 'error');
    throw err;
  }
}

// --- Formatters ---
const formatCurrency = (cents) => `$${(cents / 100).toFixed(2)}`;
const generateUUID = () => 'ord-' + Math.random().toString(36).substring(2, 7) + '-' + Date.now().toString(36).slice(-4);

// --- Health Check ---
async function checkHealth() {
  try {
    const { json, ok } = await api('/health');
    if (ok) {
      els.pgStatusVal.textContent = json.postgres.toUpperCase();
      els.redisStatusVal.textContent = json.redis.includes('up') ? 'ONLINE (REDIS)' : 'ACTIVE (FAIL-OPEN)';
      
      const redisModeElem = document.getElementById('metric-redis-mode');
      if (redisModeElem) {
        redisModeElem.textContent = json.redis.includes('up') ? 'REDIS READY' : 'FAIL-OPEN MEM';
      }
    }
  } catch (_) {
    els.pgStatusVal.textContent = 'OFFLINE';
    els.redisStatusVal.textContent = 'OFFLINE';
  }
}

// --- Users Management ---
async function loadUsers() {
  try {
    const { json } = await api('/users');
    if (Array.isArray(json) && json.length > 0) {
      state.users = json;
      els.userSelect.innerHTML = '';
      json.forEach((u) => {
        const opt = document.createElement('option');
        opt.value = u.id;
        opt.textContent = `${u.name} (ID: ${u.id})`;
        els.userSelect.appendChild(opt);
      });
      els.userSelect.value = state.currentUserId;
      updateCurrentBuyerName();
    }
  } catch (err) {
    logEvent('Error loading users: ' + err.message, 'error');
  }
}

function updateCurrentBuyerName() {
  const current = state.users.find((u) => String(u.id) === String(state.currentUserId));
  els.cartBuyerName.textContent = current ? current.name : `User ${state.currentUserId}`;
}

async function createNewUser() {
  const name = prompt('Enter new buyer name:');
  if (!name || !name.trim()) return;
  const email = `buyer-${Date.now()}@example.com`;

  try {
    const { ok, json } = await api('/users', {
      method: 'POST',
      body: JSON.stringify({ name: name.trim(), email }),
    });
    if (ok) {
      logEvent(`Created buyer ${json.name} (#${json.id})`, 'success');
      await loadUsers();
      state.currentUserId = json.id;
      els.userSelect.value = json.id;
      updateCurrentBuyerName();
      await loadCart();
      await loadOrders();
    }
  } catch (err) {
    alert('Failed to create buyer: ' + err.message);
  }
}

// --- Products Catalog ---
async function loadProducts() {
  try {
    const { json, headers } = await api('/products');
    if (Array.isArray(json)) {
      state.products = json;
      const cacheHit = headers.get('x-cache') === 'HIT';
      renderProducts(json, cacheHit);
      populateAdminProductSelect(json);
    }
  } catch (err) {
    els.productsList.innerHTML = `<div class="empty-cart-msg">Failed to load products: ${err.message}</div>`;
  }
}

function renderProducts(products, cacheHit) {
  if (!products.length) {
    els.productsList.innerHTML = '<div class="empty-cart-msg">No products in catalog. Click "Reset DB" to seed.</div>';
    return;
  }

  els.productsList.innerHTML = products.map((p) => {
    const isSoldOut = p.stock <= 0;
    const isLowStock = p.stock > 0 && p.stock <= 5;
    const stockStatus = isSoldOut ? 'sold-out' : isLowStock ? 'low-stock' : 'in-stock';
    const statusLabel = isSoldOut ? 'SOLD OUT' : isLowStock ? `ONLY ${p.stock} LEFT!` : `${p.stock} IN STOCK`;

    // Max capacity estimation for progress bar
    const maxCapacity = Math.max(p.stock, 20);
    const stockPct = isSoldOut ? 0 : Math.min(100, Math.round((p.stock / maxCapacity) * 100));

    // Icon based on product title
    const icon = p.name.includes('Earbuds') ? '🎧' : p.name.includes('Watch') ? '⌚' : p.name.includes('Keyboard') ? '⌨️' : '⚡';

    return `
      <div class="product-card" id="product-card-${p.id}">
        <div class="product-thumb">
          <span>${icon}</span>
        </div>

        <div class="product-body">
          <div class="product-title-row">
            <span class="product-name">${escapeHtml(p.name)}</span>
            <span class="cache-pill ${cacheHit ? 'hit' : 'miss'}">
              ${cacheHit ? '⚡ CACHE HIT' : 'DB READ'}
            </span>
          </div>
          <div class="product-desc">${escapeHtml(p.description || 'Limited flash sale inventory unit.')}</div>

          <div class="stock-meter-wrap">
            <div class="stock-meter-header">
              <span class="stock-status-tag ${stockStatus}">${statusLabel}</span>
              <span class="font-mono text-muted">${p.stock} units remaining</span>
            </div>
            <div class="stock-track">
              <div class="stock-fill ${isSoldOut ? 'out' : isLowStock ? 'low' : ''}" style="width: ${stockPct}%"></div>
            </div>
          </div>
        </div>

        <div class="product-buy-col">
          <div class="product-price">${formatCurrency(p.priceCents)}</div>
          
          <div class="qty-control">
            <button class="btn-qty" onclick="changeProductQty(${p.id}, -1)">-</button>
            <span class="qty-val" id="qty-input-${p.id}">1</span>
            <button class="btn-qty" onclick="changeProductQty(${p.id}, 1)">+</button>
          </div>

          <button class="btn-add-cart" id="btn-add-${p.id}" ${isSoldOut ? 'disabled' : ''} onclick="addToCartClicked(${p.id})">
            ${isSoldOut ? 'Sold Out' : '+ Add to Cart'}
          </button>
        </div>
      </div>
    `;
  }).join('');
}

window.changeProductQty = function(productId, delta) {
  const elem = document.getElementById(`qty-input-${productId}`);
  if (!elem) return;
  let val = parseInt(elem.textContent, 10) + delta;
  if (val < 1) val = 1;
  if (val > 5) val = 5; // Enforce max limit of 5 per item
  elem.textContent = val;
};

window.addToCartClicked = async function(productId) {
  const qtyElem = document.getElementById(`qty-input-${productId}`);
  const quantity = qtyElem ? parseInt(qtyElem.textContent, 10) : 1;
  await updateCartItem(productId, quantity);
};

// --- Cart Operations ---
async function loadCart() {
  try {
    const { json, ok } = await api('/cart', {
      headers: { 'X-User-Id': String(state.currentUserId) },
    });
    if (ok) {
      state.cart = json;
      renderCart(json);
    }
  } catch (err) {
    logEvent('Error loading cart: ' + err.message, 'error');
  }
}

function renderCart(cart) {
  const count = (cart.items || []).reduce((sum, item) => sum + item.quantity, 0);
  els.cartBadge.textContent = count;
  els.cartTotalDisplay.textContent = formatCurrency(cart.totalCents || 0);

  if (!cart.items || !cart.items.length) {
    els.cartItemsContainer.innerHTML = '<div class="empty-cart-msg">Your cart is empty. Add a product above!</div>';
    return;
  }

  els.cartItemsContainer.innerHTML = cart.items.map((item) => `
    <div class="cart-item-row" id="cart-item-${item.productId}">
      <div class="cart-item-info">
        <strong>${item.quantity}x</strong>
        <span>${escapeHtml(item.name)}</span>
      </div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <span class="font-mono">${formatCurrency(item.lineTotalCents)}</span>
        <button class="cart-item-remove" onclick="removeCartItemClicked(${item.productId})" title="Remove item">✕</button>
      </div>
    </div>
  `).join('');
}

async function updateCartItem(productId, quantity) {
  try {
    const { ok, json } = await api(`/cart/items/${productId}`, {
      method: 'PUT',
      headers: { 'X-User-Id': String(state.currentUserId) },
      body: JSON.stringify({ quantity }),
    });
    if (ok) {
      state.cart = json;
      renderCart(json);
      logEvent(`Added ${quantity}x product #${productId} to cart`, 'success');
    } else {
      alert(`Cart Error: ${json.error?.message || 'Could not update item'}`);
    }
  } catch (err) {
    alert(`Failed to add item: ${err.message}`);
  }
}

window.removeCartItemClicked = async function(productId) {
  try {
    const { ok, json } = await api(`/cart/items/${productId}`, {
      method: 'DELETE',
      headers: { 'X-User-Id': String(state.currentUserId) },
    });
    if (ok) {
      state.cart = json;
      renderCart(json);
      logEvent(`Removed product #${productId} from cart`, 'info');
    }
  } catch (err) {
    alert(`Failed to remove item: ${err.message}`);
  }
};

async function clearCart() {
  if (!state.cart.items || !state.cart.items.length) return;
  for (const item of state.cart.items) {
    await api(`/cart/items/${item.productId}`, {
      method: 'DELETE',
      headers: { 'X-User-Id': String(state.currentUserId) },
    });
  }
  await loadCart();
}

// --- Checkout & Idempotency Testing ---
async function executeCheckout({ doubleClick = false } = {}) {
  const key = els.inputIdempotencyKey.value.trim();
  if (!key) {
    alert('Please provide an Idempotency-Key header value.');
    return;
  }

  els.btnCheckoutSingle.disabled = true;
  els.btnCheckoutDouble.disabled = true;
  els.checkoutResultBox.classList.remove('hidden');
  els.resultBadge.className = 'result-status-badge';
  els.resultBadge.textContent = 'CHECKING OUT...';
  els.resultDetailsText.textContent = 'Submitting transaction to database...';

  const sendReq = (burstIndex) => api('/checkout', {
    method: 'POST',
    headers: {
      'X-User-Id': String(state.currentUserId),
      'Idempotency-Key': key,
    },
  }).then((res) => ({ ...res, burstIndex }));

  try {
    if (!doubleClick) {
      // Single normal checkout
      const res = await sendReq(1);
      renderCheckoutResult([res]);
    } else {
      // Parallel burst double-click simulation with exact same Idempotency-Key!
      logEvent(`🚀 FIRING PARALLEL DOUBLE-CLICK BURST with key "${key}"...`, 'warn');
      const results = await Promise.all([sendReq(1), sendReq(2)]);
      renderCheckoutResult(results);
    }

    // Refresh application state
    await loadProducts();
    await loadCart();
    await loadOrders();
    if (state.activeTab === 'tab-admin') await loadAdminOrders();
  } catch (err) {
    els.resultBadge.className = 'result-status-badge status-error';
    els.resultBadge.textContent = 'ERROR';
    els.resultDetailsText.textContent = err.message;
  } finally {
    els.btnCheckoutSingle.disabled = false;
    els.btnCheckoutDouble.disabled = false;
  }
}

function renderCheckoutResult(results) {
  if (results.length === 1) {
    const res = results[0];
    const isReplay = res.headers.get('idempotent-replay') === 'true';

    if (res.ok) {
      els.resultBadge.className = `result-status-badge ${isReplay ? 'status-replay' : 'status-201'}`;
      els.resultBadge.textContent = isReplay ? '201 REPLAY (ABSORBED)' : '201 CONFIRMED';
      els.resultTiming.textContent = `${res.ms}ms`;
      els.resultDetailsText.textContent = JSON.stringify(res.json, null, 2);
      if (!isReplay) {
        // Auto-generate fresh key for next order
        els.inputIdempotencyKey.value = generateUUID();
      }
    } else {
      els.resultBadge.className = 'result-status-badge status-error';
      els.resultBadge.textContent = `${res.status} ${res.json.error?.code || 'FAILED'}`;
      els.resultTiming.textContent = `${res.ms}ms`;
      els.resultDetailsText.textContent = res.json.error?.message || JSON.stringify(res.json);
    }
  } else {
    // Double click comparison
    const [r1, r2] = results;
    const hasReplay = r1.headers.get('idempotent-replay') === 'true' || r2.headers.get('idempotent-replay') === 'true';

    els.resultBadge.className = hasReplay ? 'result-status-badge status-replay' : 'result-status-badge status-201';
    els.resultBadge.textContent = 'PARALLEL DOUBLE-CLICK COMPLETE';
    els.resultTiming.textContent = `Req1: ${r1.ms}ms | Req2: ${r2.ms}ms`;

    els.resultDetailsText.textContent = 
`[REQUEST 1]: Status ${r1.status} | Idempotent-Replay: ${r1.headers.get('idempotent-replay')}
Order ID: ${r1.json.orderId || 'None'} | Total: ${r1.json.totalCents ? formatCurrency(r1.json.totalCents) : 'N/A'}

[REQUEST 2]: Status ${r2.status} | Idempotent-Replay: ${r2.headers.get('idempotent-replay')}
Order ID: ${r2.json.orderId || 'None'} | Total: ${r2.json.totalCents ? formatCurrency(r2.json.totalCents) : 'N/A'}

✅ VERDICT: ${hasReplay ? 'Idempotency protected! Two clicks processed, exactly ONE order generated.' : 'Both requests completed.'}`;
  }
}

// --- Orders History & Cancellation ---
async function loadOrders() {
  try {
    const { json, ok } = await api('/orders', {
      headers: { 'X-User-Id': String(state.currentUserId) },
    });
    if (ok && Array.isArray(json)) {
      els.userOrdersCount.textContent = json.length;
      renderOrders(json);
    }
  } catch (err) {
    els.ordersList.innerHTML = `<div class="empty-cart-msg">Failed to load orders: ${err.message}</div>`;
  }
}

function renderOrders(orders) {
  if (!orders.length) {
    els.ordersList.innerHTML = '<div class="empty-cart-msg">No orders placed yet. Place an order in the Storefront tab!</div>';
    return;
  }

  els.ordersList.innerHTML = orders.map((o) => {
    const isCancelled = o.status === 'CANCELLED';
    const dateStr = new Date(o.createdAt).toLocaleString();

    return `
      <div class="order-card" id="order-card-${o.orderId}">
        <div class="order-header">
          <div class="order-id-group">
            <span class="order-title">Order #${o.orderId}</span>
            <span class="status-badge ${o.status}">${o.status}</span>
          </div>
          <span class="order-date">${dateStr}</span>
        </div>

        <div class="order-footer">
          <div>
            <span class="text-muted" style="font-size: 0.8rem;">Total: </span>
            <span class="order-total-price">${formatCurrency(o.totalCents)}</span>
          </div>

          <button class="btn-cancel-order" ${isCancelled ? 'disabled' : ''} onclick="cancelOrderClicked(${o.orderId})">
            ${isCancelled ? 'Already Cancelled' : 'Cancel & Restock Inventory'}
          </button>
        </div>
      </div>
    `;
  }).join('');
}

window.cancelOrderClicked = async function(orderId) {
  if (!confirm(`Cancel Order #${orderId} and return its units back into stock?`)) return;

  try {
    const { ok, json } = await api(`/orders/${orderId}/cancel`, {
      method: 'POST',
      headers: { 'X-User-Id': String(state.currentUserId) },
    });
    if (ok) {
      logEvent(`Order #${orderId} cancelled. Units returned to inventory!`, 'success');
      await loadOrders();
      await loadProducts();
      if (state.activeTab === 'tab-admin') await loadAdminOrders();
    } else {
      alert(`Cancellation failed: ${json.error?.message || 'Could not cancel order'}`);
    }
  } catch (err) {
    alert(`Failed to cancel order: ${err.message}`);
  }
};

// --- Concurrency Load Simulator ---
async function runConcurrencySimulation() {
  const buyers = parseInt(els.simBuyersCount.value, 10);
  const stock = parseInt(els.simStockCount.value, 10);
  const dupRate = parseInt(els.simDupRate.value, 10) / 100;

  els.btnRunSimulation.disabled = true;
  els.simProgressWrapper.classList.remove('hidden');
  els.simResultsContainer.classList.add('hidden');
  els.simProgressBar.style.width = '10%';
  els.simProgressStatus.textContent = 'Creating special flash product...';
  els.simProgressPct.textContent = '10%';

  logEvent(`🏁 STARTING FLASH SALE SIMULATION: ${buyers} buyers, ${stock} stock, ${dupRate * 100}% dupes`, 'warn');

  const runId = Date.now();

  try {
    // 1. Create dedicated flash sale product
    const { ok: pOk, json: product } = await api('/products', {
      method: 'POST',
      headers: { 'X-Admin-Key': state.adminKey },
      body: JSON.stringify({
        name: `Flash Super-Drop #${runId.toString().slice(-4)}`,
        description: `High-concurrency stress test item with strictly ${stock} units.`,
        priceCents: 9900,
        stock,
      }),
    });
    if (!pOk || !product.id) throw new Error('Failed to create test product');

    // 2. Prepare buyers
    els.simProgressBar.style.width = '35%';
    els.simProgressStatus.textContent = `Preparing ${buyers} simulated buyers...`;
    els.simProgressPct.textContent = '35%';

    const users = await Promise.all(
      Array.from({ length: buyers }, (_, i) =>
        api('/users', {
          method: 'POST',
          body: JSON.stringify({ name: `Sim Buyer ${i + 1}`, email: `sim-${runId}-${i}@test.com` }),
        }).then((r) => r.json)
      )
    );

    // 3. Fill carts
    els.simProgressBar.style.width = '60%';
    els.simProgressStatus.textContent = `Filling carts for ${buyers} buyers...`;
    els.simProgressPct.textContent = '60%';

    await Promise.all(
      users.map((u) =>
        api(`/cart/items/${product.id}`, {
          method: 'PUT',
          headers: { 'X-User-Id': String(u.id) },
          body: JSON.stringify({ quantity: 1 }),
        })
      )
    );

    // 4. Fire the barrage
    els.simProgressBar.style.width = '80%';
    els.simProgressStatus.textContent = `Simultaneous checkout barrage unleashed!`;
    els.simProgressPct.textContent = '80%';

    const t0 = performance.now();
    const attempts = [];
    for (const u of users) {
      const key = `sim-run-${runId}-${u.id}`;
      const send = () => api('/checkout', {
        method: 'POST',
        headers: { 'X-User-Id': String(u.id), 'Idempotency-Key': key },
      });
      attempts.push(send());
      if (Math.random() < dupRate) {
        attempts.push(send()); // Parallel double click
      }
    }

    const results = await Promise.all(attempts);
    const elapsedSec = (performance.now() - t0) / 1000;

    // 5. Audit the DB
    els.simProgressBar.style.width = '95%';
    els.simProgressStatus.textContent = 'Executing PostgreSQL row audit...';
    els.simProgressPct.textContent = '95%';

    const { json: audit } = await api(`/admin/products/${product.id}/audit`, {
      headers: { 'X-Admin-Key': state.adminKey },
    });

    els.simProgressBar.style.width = '100%';
    els.simProgressPct.textContent = '100%';
    els.simProgressStatus.textContent = 'Simulation and database audit complete!';

    // 6. Compute statistics
    const count = (fn) => results.filter(fn).length;
    const created = count((r) => r.status === 201 && r.headers.get('idempotent-replay') === 'false');
    const replays = count((r) => r.status === 201 && r.headers.get('idempotent-replay') === 'true');
    const soldOut = count((r) => r.status === 409);
    const limited = count((r) => r.status === 429);
    const errors = count((r) => r.status >= 500);
    const lat = results.map((r) => parseFloat(r.ms)).sort((a, b) => a - b);
    const percentile = (p) => lat[Math.min(lat.length - 1, Math.floor((p / 100) * lat.length))].toFixed(0);

    const oversold = audit.confirmedUnits > stock || audit.stock < 0;
    const consistent = audit.stock + audit.confirmedUnits === stock;

    // 7. Render results
    els.statTotalReqs.textContent = results.length;
    els.statConfirmedOrders.textContent = created;
    els.statReplays.textContent = replays;
    els.statSoldOut.textContent = soldOut;
    els.statLimited.textContent = limited;
    els.statErrors.textContent = errors;
    els.statThroughput.textContent = `${Math.round(results.length / elapsedSec)} req/s`;
    els.statElapsed.textContent = `over ${elapsedSec.toFixed(2)}s`;
    els.statLatencies.textContent = `${percentile(50)}ms / ${percentile(95)}ms / ${percentile(99)}ms`;

    if (!oversold && consistent && errors === 0) {
      els.simInvariantCard.className = 'card invariant-card';
      els.invariantIcon.textContent = '✓';
      els.invariantStatusTitle.textContent = 'DATABASE INVARIANT VERIFIED: ZERO OVERSELLING';
      els.invariantMathFormula.textContent = `Initial Stock (${stock}) == Remaining (${audit.stock}) + Confirmed Sold (${audit.confirmedUnits})`;
      els.invariantExplanation.textContent = `All ${results.length} checkout attempts resolved safely. No negative inventory and exactly ${stock} orders confirmed.`;
      logEvent(`🏆 INVARIANT HELD: Stock (${audit.stock}) + Sold (${audit.confirmedUnits}) == ${stock}`, 'success');
    } else {
      els.simInvariantCard.className = 'card invariant-card failed';
      els.invariantIcon.textContent = '✕';
      els.invariantStatusTitle.textContent = 'INVARIANT FAILURE DETECTED!';
      els.invariantMathFormula.textContent = `Initial (${stock}) != Remaining (${audit.stock}) + Sold (${audit.confirmedUnits})`;
      logEvent(`BUG DETECTED during simulation!`, 'error');
    }

    els.simResultsContainer.classList.remove('hidden');
    await loadProducts();
  } catch (err) {
    alert('Simulation error: ' + err.message);
    logEvent('Simulation error: ' + err.message, 'error');
  } finally {
    els.btnRunSimulation.disabled = false;
  }
}

// --- Admin Operations ---
function populateAdminProductSelect(products) {
  els.adminSelectProduct.innerHTML = '<option value="">Select a product to edit/audit...</option>';
  products.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `#${p.id} - ${p.name} (Stock: ${p.stock})`;
    els.adminSelectProduct.appendChild(opt);
  });
}

async function handleAdminSelectProductChange() {
  const id = els.adminSelectProduct.value;
  if (!id) {
    els.adminInputStock.value = '';
    els.adminInputPrice.value = '';
    els.auditResultDisplay.classList.add('hidden');
    return;
  }
  const p = state.products.find((item) => String(item.id) === String(id));
  if (p) {
    els.adminInputStock.value = p.stock;
    els.adminInputPrice.value = (p.priceCents / 100).toFixed(2);
  }
}

async function updateProductAdmin() {
  const id = els.adminSelectProduct.value;
  if (!id) {
    alert('Please select a product first.');
    return;
  }
  const stock = parseInt(els.adminInputStock.value, 10);
  const priceCents = Math.round(parseFloat(els.adminInputPrice.value) * 100);

  try {
    const { ok, json } = await api(`/products/${id}`, {
      method: 'PATCH',
      headers: { 'X-Admin-Key': state.adminKey },
      body: JSON.stringify({ stock, priceCents }),
    });
    if (ok) {
      logEvent(`Admin updated product #${id}: stock set to ${stock}, price to ${formatCurrency(priceCents)}`, 'success');
      alert(`Product #${id} updated! Redis sold-out flag cleared.`);
      await loadProducts();
    } else {
      alert(`Update failed: ${json.error?.message || 'Error updating product'}`);
    }
  } catch (err) {
    alert(`Failed: ${err.message}`);
  }
}

async function runProductAudit() {
  const id = els.adminSelectProduct.value;
  if (!id) {
    alert('Please select a product to audit.');
    return;
  }

  try {
    const { ok, json } = await api(`/admin/products/${id}/audit`, {
      headers: { 'X-Admin-Key': state.adminKey },
    });
    if (ok) {
      els.auditPId.textContent = json.productId;
      els.auditPStock.textContent = json.stock;
      els.auditPSold.textContent = json.confirmedUnits;
      els.auditPOrders.textContent = json.confirmedOrders;
      els.auditPSum.textContent = json.stockPlusSold;
      els.auditResultDisplay.classList.remove('hidden');
      logEvent(`Audited product #${id}: stock=${json.stock}, confirmedUnits=${json.confirmedUnits}`, 'info');
    }
  } catch (err) {
    alert(`Audit failed: ${err.message}`);
  }
}

async function loadAdminOrders() {
  try {
    const { ok, json } = await api('/admin/orders', {
      headers: { 'X-Admin-Key': state.adminKey },
    });
    if (ok && Array.isArray(json)) {
      if (!json.length) {
        els.adminOrdersTbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No orders found in ledger.</td></tr>';
        return;
      }
      els.adminOrdersTbody.innerHTML = json.map((o) => `
        <tr>
          <td class="font-mono">#${o.id}</td>
          <td><strong>${escapeHtml(o.user_name)}</strong><br><small class="text-muted">${escapeHtml(o.user_email)}</small></td>
          <td><span class="status-badge ${o.status}">${o.status}</span></td>
          <td class="font-mono font-bold">${formatCurrency(o.total_cents)}</td>
          <td>${(o.items || []).map((i) => `${i.quantity}x ${escapeHtml(i.product_name)}`).join(', ') || '-'}</td>
          <td class="text-muted">${new Date(o.created_at).toLocaleTimeString()}</td>
        </tr>
      `).join('');
    }
  } catch (err) {
    els.adminOrdersTbody.innerHTML = `<tr><td colspan="6" class="text-center text-rose">${err.message}</td></tr>`;
  }
}

async function resetSystemDatabase() {
  if (!confirm('Reset database to clean default state with 3 products and 5 demo users?')) return;

  try {
    const { ok } = await api('/admin/reset', {
      method: 'POST',
      headers: { 'X-Admin-Key': state.adminKey },
    });
    if (ok) {
      logEvent('Database reset & seeded successfully.', 'success');
      await loadUsers();
      await loadProducts();
      await loadCart();
      await loadOrders();
      if (state.activeTab === 'tab-admin') await loadAdminOrders();
      alert('System successfully reset and reseeded!');
    }
  } catch (err) {
    alert(`Reset failed: ${err.message}`);
  }
}

// --- Utilities ---
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// --- Event Listeners Setup ---
function setupEventListeners() {
  // Tabs
  els.tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      els.tabBtns.forEach((b) => b.classList.remove('active'));
      els.tabPanes.forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(target).classList.add('active');
      state.activeTab = target;

      if (target === 'tab-orders') loadOrders();
      if (target === 'tab-admin') loadAdminOrders();
    });
  });

  // User switcher
  els.userSelect.addEventListener('change', (e) => {
    state.currentUserId = parseInt(e.target.value, 10);
    updateCurrentBuyerName();
    loadCart();
    loadOrders();
    logEvent(`Switched active buyer to #${state.currentUserId}`, 'info');
  });

  els.btnNewUser.addEventListener('click', createNewUser);

  // Cart & Idempotency controls
  els.btnGenKey.addEventListener('click', () => {
    els.inputIdempotencyKey.value = generateUUID();
  });

  els.btnOpenCart.addEventListener('click', () => {
    document.getElementById('tab-btn-store').click();
    document.getElementById('checkout-panel').scrollIntoView({ behavior: 'smooth' });
  });

  els.btnClearCart.addEventListener('click', clearCart);

  els.btnCheckoutSingle.addEventListener('click', () => executeCheckout({ doubleClick: false }));
  els.btnCheckoutDouble.addEventListener('click', () => executeCheckout({ doubleClick: true }));

  els.btnRefreshProducts.addEventListener('click', loadProducts);
  els.btnRefreshOrders.addEventListener('click', loadOrders);
  els.btnQuickReset.addEventListener('click', resetSystemDatabase);

  // Simulator controls
  els.simBuyersCount.addEventListener('input', (e) => {
    els.simBuyersVal.textContent = e.target.value;
  });
  els.simStockCount.addEventListener('input', (e) => {
    els.simStockVal.textContent = e.target.value;
  });
  els.simDupRate.addEventListener('input', (e) => {
    els.simDupVal.textContent = `${e.target.value}%`;
  });
  els.btnRunSimulation.addEventListener('click', runConcurrencySimulation);

  // Admin controls
  els.adminSelectProduct.addEventListener('change', handleAdminSelectProductChange);
  els.btnAdminUpdateProduct.addEventListener('click', updateProductAdmin);
  els.btnRunAudit.addEventListener('click', runProductAudit);
  els.btnRefreshAdminOrders.addEventListener('click', loadAdminOrders);

  // Terminal
  els.btnClearLog.addEventListener('click', () => {
    els.terminalLog.innerHTML = '<div class="log-line system">[SYSTEM] Log cleared.</div>';
  });
}

// --- Initialization ---
async function init() {
  logEvent('Connecting to API services...', 'system');
  setupEventListeners();
  els.inputIdempotencyKey.value = generateUUID();

  await checkHealth();
  await loadUsers();
  await loadProducts();
  await loadCart();
  await loadOrders();

  // Periodic health check
  setInterval(checkHealth, 5000);
}

document.addEventListener('DOMContentLoaded', init);
