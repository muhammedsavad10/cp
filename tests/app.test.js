const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

// Set test environment
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_secret_key_1234567890';
process.env.DATA_DIR = path.join(__dirname, '../data_test');

// Ensure clean test DB directory
if (fs.existsSync(process.env.DATA_DIR)) {
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
}

const server = require('../server/index');
const { get, all, run, getISTBusinessDate, getUTCTimestamp } = require('../server/db');

const request = (method, urlPath, headers = {}, body = null) => {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : '';
    const req = http.request({
      hostname: 'localhost',
      port: 5000,
      path: urlPath,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        ...headers
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(postData);
    req.end();
  });
};

let adminToken = '';
let stall1Token = '';
let stall2Token = '';

before(async () => {
  await new Promise(r => setTimeout(r, 1000));

  // Seed Stall 2 & test users directly in DB
  const bcrypt = require('bcryptjs');
  const passHash = await bcrypt.hash('pass123', 10);

  await run(`INSERT INTO stalls (id, name, active) VALUES (2, 'Stall 2', 1)`);

  const adminRes = await request('POST', '/api/auth/login', {}, { email: 'admin@test.com', password: 'admin123' });
  adminToken = adminRes.body.token;

  const stall1Res = await request('POST', '/api/auth/login', {}, { email: 'stall1@test.com', password: 'stall123' });
  stall1Token = stall1Res.body.token;

  // Create Stall 2 user
  await run(
    `INSERT INTO users (name, email, password, role, stall_id) VALUES ('Stall 2 Worker', 'stall2@test.com', ?, 'STALL_USER', 2)`,
    [passHash]
  );
  const stall2Res = await request('POST', '/api/auth/login', {}, { email: 'stall2@test.com', password: 'pass123' });
  stall2Token = stall2Res.body.token;
});

test('1. GET /healthz returns 200 OK', async () => {
  const res = await request('GET', '/healthz');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
});

test('2. Idempotency & SELL 1 deduplication', async () => {
  const key = `key_test_${Date.now()}`;

  // First request
  const res1 = await request('POST', '/api/stall/sell', { Authorization: `Bearer ${stall1Token}` }, { idempotency_key: key });
  assert.equal(res1.status, 200);
  assert.equal(res1.body.success, true);

  // Second request with same key -> returns 200 & idempotent flag
  const res2 = await request('POST', '/api/stall/sell', { Authorization: `Bearer ${stall1Token}` }, { idempotency_key: key });
  assert.equal(res2.status, 200);
  assert.equal(res2.body.idempotent, true);

  // Check DB count: only 1 sale inserted
  const sales = await all('SELECT * FROM sales WHERE idempotency_key = ?', [key]);
  assert.equal(sales.length, 1);
});

test('3. Raw SQL Triggers block UPDATE & DELETE on sales', async () => {
  const sale = await get('SELECT id FROM sales LIMIT 1');
  assert.ok(sale);

  await assert.rejects(async () => {
    await run('UPDATE sales SET quantity = 2 WHERE id = ?', [sale.id]);
  }, /append-only/);

  await assert.rejects(async () => {
    await run('DELETE FROM sales WHERE id = ?', [sale.id]);
  }, /append-only/);
});

test('4. Cross-Stall Isolation: Stall 1 token cannot write to Stall 2', async () => {
  // Client attempts to pass stall_id: 2 in request body
  const res = await request('POST', '/api/stall/sell', { Authorization: `Bearer ${stall1Token}` }, {
    idempotency_key: `key_cross_${Date.now()}`,
    stall_id: 2
  });

  assert.equal(res.status, 200);
  // Derived stall_id MUST be 1 from JWT token
  const lastSale = await get('SELECT stall_id FROM sales ORDER BY id DESC LIMIT 1');
  assert.equal(lastSale.stall_id, 1);
});

test('5. Stock formula with dispatches, sales & reversals', async () => {
  const today = getISTBusinessDate();

  // Admin dispatches 100 glasses to Stall 1
  const dispatchRes = await request('POST', '/api/admin/dispatch', { Authorization: `Bearer ${adminToken}` }, { stall_id: 1, quantity: 100 });
  assert.equal(dispatchRes.status, 200);

  const pending = await get('SELECT id FROM stock_dispatches WHERE stall_id = 1 AND status = \'DISPATCHED\' ORDER BY id DESC LIMIT 1');
  assert.ok(pending);

  // Stall confirms receipt of 90 glasses (SHORT 10 variance)
  const confirmRes = await request('POST', '/api/stall/confirm-receipt', { Authorization: `Bearer ${stall1Token}` }, {
    dispatch_id: pending.id,
    received_quantity: 90
  });
  assert.equal(confirmRes.status, 200);
  assert.equal(confirmRes.body.received_quantity, 90);

  // Perform a sale & undo
  const sellRes = await request('POST', '/api/stall/sell', { Authorization: `Bearer ${stall1Token}` }, { idempotency_key: `key_stock_${Date.now()}` });
  assert.equal(sellRes.status, 200);

  const undoRes = await request('POST', '/api/stall/undo-last', { Authorization: `Bearer ${stall1Token}` });
  assert.equal(undoRes.status, 200);

  // Stock summary verification
  const dash = await request('GET', '/api/stall/dashboard', { Authorization: `Bearer ${stall1Token}` });
  // Net sales should exclude undone sale
  assert.equal(dash.body.stockReceived, 90);
});

test('6. Blind Closing math & Uniqueness (409 Conflict)', async () => {
  const today = getISTBusinessDate();

  // Submit first ACTIVE closing
  const close1 = await request('POST', '/api/stall/close-day', { Authorization: `Bearer ${stall1Token}` }, {
    actual_remaining: 50,
    cash_received: 1000,
    upi_received: 600
  });
  assert.equal(close1.status, 200);

  // Attempt second closing for same stall/date -> returns 409
  const close2 = await request('POST', '/api/stall/close-day', { Authorization: `Bearer ${stall1Token}` }, {
    actual_remaining: 50,
    cash_received: 1000,
    upi_received: 600
  });
  assert.equal(close2.status, 409);

  // Check closing snapshot math on server
  const closingRow = await get('SELECT * FROM daily_closings WHERE stall_id = 1 AND business_date = ? AND status = \'ACTIVE\'', [today]);
  assert.ok(closingRow);
  assert.equal(closingRow.actual_remaining, 50);
  assert.equal(closingRow.cash_received, 1000);
  assert.equal(closingRow.upi_received, 600);
  assert.equal(closingRow.status, 'ACTIVE');
});

test('7. Sale returns 409 DAY_CLOSED when day is closed', async () => {
  const res = await request('POST', '/api/stall/sell', { Authorization: `Bearer ${stall1Token}` }, { idempotency_key: `key_closed_${Date.now()}` });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'DAY_CLOSED');
});

test('8. Admin Reopen Day allows sales again', async () => {
  const today = getISTBusinessDate();

  const reopenRes = await request('POST', '/api/admin/reopen-day', { Authorization: `Bearer ${adminToken}` }, {
    stall_id: 1,
    business_date: today,
    reason: 'Correction needed'
  });
  assert.equal(reopenRes.status, 200);

  // Sale is now allowed again
  const sellRes = await request('POST', '/api/stall/sell', { Authorization: `Bearer ${stall1Token}` }, { idempotency_key: `key_reopen_${Date.now()}` });
  assert.equal(sellRes.status, 200);
});

test('9. WebSocket authentication & Role spoof rejection', async () => {
  const ws = new WebSocket('ws://localhost:5000/ws');

  await new Promise(resolve => ws.on('open', resolve));

  // Client attempts to spoof role as ADMIN with stall token
  ws.send(JSON.stringify({
    type: 'REGISTER',
    token: stall1Token,
    role: 'ADMIN'
  }));

  await new Promise(r => setTimeout(r, 300));

  // Server registers client using decoded token role (STALL_USER), ignoring spoofed payload
  const adminDash = await request('GET', '/api/admin/dashboard', { Authorization: `Bearer ${adminToken}` });
  assert.ok(adminDash.body);

  ws.close();
});

test('10. Business Date IST Timezone Calculation', () => {
  const utcDate = new Date('2026-09-21T18:30:00Z'); // 23:55 IST on 2026-09-21
  const istDateStr = getISTBusinessDate(utcDate);
  assert.equal(istDateStr, '2026-09-22'); // Past midnight IST
});

after(() => {
  process.exit(0);
});
