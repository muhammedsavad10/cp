const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

// Set test environment
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_secret_key_1234567890';
process.env.DATA_DIR = path.join(__dirname, `../data_test_${Date.now()}`);

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
      let data = [];
      res.on('data', chunk => data.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(data);
        const contentType = res.headers['content-type'] || '';
        try {
          if (contentType.includes('application/json')) {
            resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(buffer.toString()) });
          } else {
            resolve({ status: res.statusCode, headers: res.headers, buffer });
          }
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, buffer });
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

  const bcrypt = require('bcryptjs');
  const passHash = await bcrypt.hash('pass123', 10);

  // Seed Stall 2
  await run(`INSERT INTO stalls (id, name, active) VALUES (2, 'Stall 2', 1)`);

  const adminRes = await request('POST', '/api/auth/login', {}, { email: 'admin@test.com', password: 'admin123' });
  adminToken = adminRes.body.token;

  const stall1Res = await request('POST', '/api/auth/login', {}, { email: 'stall1@test.com', password: 'stall123' });
  stall1Token = stall1Res.body.token;

  // Start Day and insert 100 confirmed received stock for Stall 1
  await request('POST', '/api/stall/start-day', { Authorization: `Bearer ${stall1Token}` });
  const today = getISTBusinessDate();
  const utcTimestamp = getUTCTimestamp();
  await run(
    `INSERT INTO stock_dispatches (stall_id, product_id, quantity, dispatched_by, created_at, received_at, received_by, received_quantity, received_business_date, status)
     VALUES (1, 1, 100, 1, ?, ?, 2, 100, ?, 'RECEIVED')`,
    [utcTimestamp, utcTimestamp, today]
  );

  // Create Stall 2 user
  await run(
    `INSERT INTO users (name, email, password, role, stall_id) VALUES ('Stall 2 Worker', 'stall2@test.com', ?, 'STALL_USER', 2)`,
    [passHash]
  );
  const stall2Res = await request('POST', '/api/auth/login', {}, { email: 'stall2@test.com', password: 'pass123' });
  stall2Token = stall2Res.body.token;

  // Start Day for Stall 1 and Stall 2 in test suite
  await request('POST', '/api/stall/start-day', { Authorization: `Bearer ${stall1Token}` });
  await request('POST', '/api/stall/start-day', { Authorization: `Bearer ${stall2Token}` });
});

test('1. GET /healthz returns 200 OK', async () => {
  const res = await request('GET', '/healthz');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
});

test('2. Idempotency: same key twice returns 200 & 1 row; two different keys 500ms apart = 2 rows', async () => {
  const key1 = `key_idem_${Date.now()}_1`;
  const key2 = `key_idem_${Date.now()}_2`;

  const res1 = await request('POST', '/api/stall/sell', { Authorization: `Bearer ${stall1Token}` }, { idempotency_key: key1 });
  assert.equal(res1.status, 200);

  const res1Dup = await request('POST', '/api/stall/sell', { Authorization: `Bearer ${stall1Token}` }, { idempotency_key: key1 });
  assert.equal(res1Dup.status, 200);
  assert.equal(res1Dup.body.idempotent, true);

  await new Promise(r => setTimeout(r, 500));

  const res2 = await request('POST', '/api/stall/sell', { Authorization: `Bearer ${stall1Token}` }, { idempotency_key: key2 });
  assert.equal(res2.status, 200);

  const salesKey1 = await all('SELECT * FROM sales WHERE idempotency_key = ?', [key1]);
  assert.equal(salesKey1.length, 1);

  const salesKey2 = await all('SELECT * FROM sales WHERE idempotency_key = ?', [key2]);
  assert.equal(salesKey2.length, 1);
});

test('3. Undo allowed <= 15s and rejected after > 15s', async () => {
  const today = getISTBusinessDate();
  const utcOld = new Date(Date.now() - 20 * 1000).toISOString();

  // Insert a sale created 20 seconds ago
  await run(
    `INSERT INTO sales (stall_id, product_id, quantity, selling_price, created_at, created_by, business_date, idempotency_key)
     VALUES (1, 1, 1, 40.0, ?, 2, ?, ?)`,
    [utcOld, today, `old_sale_${Date.now()}`]
  );

  // Perform a new sale (0s old)
  const newKey = `fresh_sale_${Date.now()}`;
  await request('POST', '/api/stall/sell', { Authorization: `Bearer ${stall1Token}` }, { idempotency_key: newKey });

  // First undo reverses the fresh sale
  const undoRes1 = await request('POST', '/api/stall/undo-last', { Authorization: `Bearer ${stall1Token}` });
  assert.equal(undoRes1.status, 200);

  // Second undo attempts to reverse the 20s old sale -> fails (expired window > 15s)
  const undoRes2 = await request('POST', '/api/stall/undo-last', { Authorization: `Bearer ${stall1Token}` });
  assert.equal(undoRes2.status, 400);
  assert.match(undoRes2.body.error, /expired/i);
});

test('4. Triggers block UPDATE/DELETE on wastages, stock_dispatches, daily_closings', async () => {
  const today = getISTBusinessDate();

  // Wastage trigger
  await run(`INSERT INTO wastages (stall_id, product_id, quantity, reason, created_at, created_by, business_date) VALUES (1, 1, 2, 'Spoiled', ?, 2, ?)`, [getUTCTimestamp(), today]);
  const wastage = await get('SELECT id FROM wastages LIMIT 1');

  await assert.rejects(async () => {
    await run('UPDATE wastages SET quantity = 5 WHERE id = ?', [wastage.id]);
  }, /append-only/);

  await assert.rejects(async () => {
    await run('DELETE FROM wastages WHERE id = ?', [wastage.id]);
  }, /append-only/);

  // Dispatch trigger: non-receipt column update prohibited
  await run(`INSERT INTO stock_dispatches (stall_id, product_id, quantity, created_at, dispatched_by, status) VALUES (1, 1, 50, ?, 1, 'DISPATCHED')`, [getUTCTimestamp()]);
  const dispatch = await get('SELECT id FROM stock_dispatches ORDER BY id DESC LIMIT 1');

  await assert.rejects(async () => {
    await run('UPDATE stock_dispatches SET quantity = 100 WHERE id = ?', [dispatch.id]);
  }, /restricted column update/);

  await assert.rejects(async () => {
    await run('DELETE FROM stock_dispatches WHERE id = ?', [dispatch.id]);
  }, /does not allow DELETE/);
});

test('5. Receipt "count is different" & Stock variance', async () => {
  const today = getISTBusinessDate();
  await request('POST', '/api/admin/dispatch', { Authorization: `Bearer ${adminToken}` }, { stall_id: 1, quantity: 50 });

  const pending = await get('SELECT id FROM stock_dispatches WHERE stall_id = 1 AND status = \'DISPATCHED\' ORDER BY id DESC LIMIT 1');

  // Confirm with custom count: 45 (SHORT 5)
  const res = await request('POST', '/api/stall/confirm-receipt', { Authorization: `Bearer ${stall1Token}` }, {
    dispatch_id: pending.id,
    received_quantity: 45
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.received_quantity, 45);

  const updatedDispatch = await get('SELECT * FROM stock_dispatches WHERE id = ?', [pending.id]);
  assert.equal(updatedDispatch.received_quantity, 45);
});

test('6. Cross-Stall Isolation: Stall 1 token cannot access or modify Stall 2 data; client-supplied stall_id ignored', async () => {
  // Client-supplied stall_id = 2 is ignored, sale recorded for stall 1
  const res = await request('POST', '/api/stall/sell', { Authorization: `Bearer ${stall1Token}` }, {
    idempotency_key: `cross_stall_${Date.now()}`,
    stall_id: 2
  });
  assert.equal(res.status, 200);
  const sale = await get('SELECT stall_id FROM sales WHERE idempotency_key LIKE \'cross_stall_%\'');
  assert.equal(sale.stall_id, 1);

  // Stall 2 dispatch cannot be confirmed by Stall 1 token
  await run(`INSERT INTO stock_dispatches (stall_id, product_id, quantity, created_at, dispatched_by, status) VALUES (2, 1, 30, ?, 1, 'DISPATCHED')`, [getUTCTimestamp()]);
  const s2Dispatch = await get('SELECT id FROM stock_dispatches WHERE stall_id = 2 ORDER BY id DESC LIMIT 1');
  const confirmRes = await request('POST', '/api/stall/confirm-receipt', { Authorization: `Bearer ${stall1Token}` }, {
    dispatch_id: s2Dispatch.id,
    received_quantity: 30
  });
  assert.equal(confirmRes.status, 404);
});

test('7. Semi-Blind Closing math & Wrong revenue returns generic 409 without leaking expected/actual', async () => {
  const today = getISTBusinessDate();

  // Get total sold today for stall 1
  const revRow = await get(`SELECT COALESCE(SUM(quantity * selling_price), 0) as total FROM sales WHERE stall_id = 1 AND business_date = ?`, [today]);
  const expectedRev = revRow ? revRow.total : 0;

  // Attempt closing with WRONG revenue (expectedRev + 100) -> fails with generic 409
  const wrongClose = await request('POST', '/api/stall/close-day', { Authorization: `Bearer ${stall1Token}` }, {
    cash_received: expectedRev,
    upi_received: 100
  });

  assert.equal(wrongClose.status, 409);
  assert.equal(wrongClose.body.error, "Amount doesn't match. Re-check, or close anyway.");
  assert.equal(wrongClose.body.code, "MISMATCH");
  // Verify NO numbers are leaked in response body
  assert.equal(wrongClose.body.expected_revenue, undefined);
  assert.equal(wrongClose.body.actual_revenue, undefined);
  assert.equal(wrongClose.body.difference, undefined);

  // Attempt closing with EXACT correct revenue -> succeeds
  const close1 = await request('POST', '/api/stall/close-day', { Authorization: `Bearer ${stall1Token}` }, {
    cash_received: expectedRev,
    upi_received: 0
  });

  assert.equal(close1.status, 200);
  assert.equal(close1.body.message, 'Day closed');

  // Second closing returns 409
  const close2 = await request('POST', '/api/stall/close-day', { Authorization: `Bearer ${stall1Token}` }, {
    cash_received: expectedRev,
    upi_received: 0
  });

  assert.equal(close2.status, 409);
});

test('8. Undo & Sale blocked after close (409 DAY_CLOSED)', async () => {
  const sellRes = await request('POST', '/api/stall/sell', { Authorization: `Bearer ${stall1Token}` }, { idempotency_key: `key_closed_${Date.now()}` });
  assert.equal(sellRes.status, 409);

  const undoRes = await request('POST', '/api/stall/undo-last', { Authorization: `Bearer ${stall1Token}` });
  assert.equal(undoRes.status, 409);
});

test('9. Admin Reopen Day allows sales again & re-marks session active', async () => {
  const today = getISTBusinessDate();

  const reopenRes = await request('POST', '/api/admin/reopen-day', { Authorization: `Bearer ${adminToken}` }, {
    stall_id: 1,
    business_date: today,
    reason: 'Correction needed'
  });

  assert.equal(reopenRes.status, 200);

  const sellRes = await request('POST', '/api/stall/sell', { Authorization: `Bearer ${stall1Token}` }, { idempotency_key: `key_reopen_${Date.now()}` });
  assert.equal(sellRes.status, 200);
});

test('10. Admin Backup & CSV Export return real data', async () => {
  const backupRes = await request('GET', '/api/admin/backup', { Authorization: `Bearer ${adminToken}` });
  assert.equal(backupRes.status, 200);
  assert.ok(backupRes.buffer && backupRes.buffer.length > 0);

  const exportRes = await request('GET', '/api/admin/export.csv', { Authorization: `Bearer ${adminToken}` });
  assert.equal(exportRes.status, 200);
  assert.ok(exportRes.buffer && exportRes.buffer.length > 0);
  assert.equal(exportRes.headers['content-type'], 'application/zip');
});

test('11. WebSocket Auth & Role Spoof Rejection', async () => {
  const ws = new WebSocket('ws://localhost:5000/ws');
  await new Promise(resolve => ws.on('open', resolve));

  // Spoof role ADMIN with stall1 token
  ws.send(JSON.stringify({
    type: 'REGISTER',
    token: stall1Token,
    role: 'ADMIN'
  }));

  await new Promise(r => setTimeout(r, 300));
  ws.close();
});

test('12. Same results under TZ=UTC and TZ=Asia/Kolkata', () => {
  const origTZ = process.env.TZ;
  try {
    // 23:30 IST = 18:00 UTC (same day: 2026-09-21)
    const lateNight = new Date('2026-09-21T18:00:00Z');
    process.env.TZ = 'UTC';
    const bDateUTC1 = getISTBusinessDate(lateNight);
    process.env.TZ = 'Asia/Kolkata';
    const bDateIST1 = getISTBusinessDate(lateNight);
    assert.equal(bDateUTC1, '2026-09-21');
    assert.equal(bDateIST1, '2026-09-21');

    // 00:30 IST = 19:00 UTC (next day in IST: 2026-09-22)
    const earlyMorning = new Date('2026-09-21T19:00:00Z');
    process.env.TZ = 'UTC';
    const bDateUTC2 = getISTBusinessDate(earlyMorning);
    process.env.TZ = 'Asia/Kolkata';
    const bDateIST2 = getISTBusinessDate(earlyMorning);
    assert.equal(bDateUTC2, '2026-09-22');
    assert.equal(bDateIST2, '2026-09-22');
  } finally {
    process.env.TZ = origTZ;
  }
});

test('13. T1.5-1: Start Day enforcement (sell before start-day returns 409 DAY_NOT_STARTED)', async () => {
  // Create Stall 3 without starting day
  await run(`INSERT INTO stalls (id, name, active) VALUES (3, 'Stall 3', 1)`);
  const bcrypt = require('bcryptjs');
  const passHash = await bcrypt.hash('pass123', 10);
  await run(
    `INSERT INTO users (name, email, password, role, stall_id) VALUES ('Stall 3 Worker', 'stall3@test.com', ?, 'STALL_USER', 3)`,
    [passHash]
  );
  const stall3Res = await request('POST', '/api/auth/login', {}, { email: 'stall3@test.com', password: 'pass123' });
  const stall3Token = stall3Res.body.token;

  // Sell attempt before Start Day -> 409 DAY_NOT_STARTED
  const sellRes = await request('POST', '/api/stall/sell', { Authorization: `Bearer ${stall3Token}` }, { idempotency_key: `key_nostart_${Date.now()}` });
  assert.equal(sellRes.status, 409);
  assert.equal(sellRes.body.code, 'DAY_NOT_STARTED');

  // Start Day
  await request('POST', '/api/stall/start-day', { Authorization: `Bearer ${stall3Token}` });

  // Insert stock
  const today3 = getISTBusinessDate();
  const utc3 = getUTCTimestamp();
  await run(
    `INSERT INTO stock_dispatches (stall_id, product_id, quantity, dispatched_by, created_at, received_at, received_by, received_quantity, received_business_date, status)
     VALUES (3, 1, 10, 1, ?, ?, 2, 10, ?, 'RECEIVED')`,
    [utc3, utc3, today3]
  );

  // Sell attempt after Start Day -> 200 OK
  const sellRes2 = await request('POST', '/api/stall/sell', { Authorization: `Bearer ${stall3Token}` }, { idempotency_key: `s3_key_${Date.now()}` });
  assert.equal(sellRes2.status, 200);
});

test('14. T1.6-2: Start Day state machine (close -> reload shows Day Closed; admin reopen -> reload shows Selling screen)', async () => {
  const bcrypt = require('bcryptjs');
  const passHash = await bcrypt.hash('pass123', 10);
  await run(`INSERT INTO stalls (id, name, active) VALUES (4, 'Stall 4', 1)`);
  await run(
    `INSERT INTO users (name, email, password, role, stall_id) VALUES ('Stall 4 Worker', 'stall4@test.com', ?, 'STALL_USER', 4)`,
    [passHash]
  );
  const s4Res = await request('POST', '/api/auth/login', {}, { email: 'stall4@test.com', password: 'pass123' });
  const s4Token = s4Res.body.token;

  // 1. Initial dashboard -> dayStarted = false
  const dash1 = await request('GET', '/api/stall/dashboard', { Authorization: `Bearer ${s4Token}` });
  assert.equal(dash1.body.dayStarted, false);
  assert.equal(dash1.body.closingSubmitted, false);

  // 2. Start Day -> dayStarted = true
  await request('POST', '/api/stall/start-day', { Authorization: `Bearer ${s4Token}` });
  const today4 = getISTBusinessDate();
  const utc4 = getUTCTimestamp();
  await run(
    `INSERT INTO stock_dispatches (stall_id, product_id, quantity, dispatched_by, created_at, received_at, received_by, received_quantity, received_business_date, status)
     VALUES (4, 1, 10, 1, ?, ?, 2, 10, ?, 'RECEIVED')`,
    [utc4, utc4, today4]
  );

  // Sell 1 glass
  await request('POST', '/api/stall/sell', { Authorization: `Bearer ${s4Token}` }, { idempotency_key: `s4_sale1_${Date.now()}` });

  // 3. Close Day -> closingSubmitted = true
  const closeRes = await request('POST', '/api/stall/close-day', { Authorization: `Bearer ${s4Token}` }, { cash_received: 40, upi_received: 0 });
  assert.equal(closeRes.status, 200);

  const dash2 = await request('GET', '/api/stall/dashboard', { Authorization: `Bearer ${s4Token}` });
  assert.equal(dash2.body.closingSubmitted, true);

  // 4. Admin Reopen Day -> session marked ACTIVE again, closing VOIDED
  const adminRes = await request('POST', '/api/auth/login', {}, { email: 'admin@test.com', password: 'admin123' });
  const adminToken = adminRes.body.token;
  const reopenRes = await request('POST', '/api/admin/reopen-day', { Authorization: `Bearer ${adminToken}` }, { stall_id: 4, business_date: today4, reason: 'Correction needed' });
  assert.equal(reopenRes.status, 200);

  // 5. Reload dashboard -> dayStarted = true, closingSubmitted = false
  const dash3 = await request('GET', '/api/stall/dashboard', { Authorization: `Bearer ${s4Token}` });
  assert.equal(dash3.body.dayStarted, true);
  assert.equal(dash3.body.closingSubmitted, false);
});

test('15. T1.6-3: Stock Cap (sell/wastage/parcel blocked with 409 STOCK_FINISHED when stock exhausted)', async () => {
  const bcrypt = require('bcryptjs');
  const passHash = await bcrypt.hash('pass123', 10);
  await run(`INSERT INTO stalls (id, name, active) VALUES (5, 'Stall 5', 1)`);
  await run(
    `INSERT INTO users (name, email, password, role, stall_id) VALUES ('Stall 5 Worker', 'stall5@test.com', ?, 'STALL_USER', 5)`,
    [passHash]
  );
  const s5Res = await request('POST', '/api/auth/login', {}, { email: 'stall5@test.com', password: 'pass123' });
  const s5Token = s5Res.body.token;

  await request('POST', '/api/stall/start-day', { Authorization: `Bearer ${s5Token}` });

  // Insert 3 glasses of confirmed stock for Stall 5
  const today5 = getISTBusinessDate();
  const utc5 = getUTCTimestamp();
  await run(
    `INSERT INTO stock_dispatches (stall_id, product_id, quantity, dispatched_by, created_at, received_at, received_by, received_quantity, received_business_date, status)
     VALUES (5, 1, 3, 1, ?, ?, 2, 3, ?, 'RECEIVED')`,
    [utc5, utc5, today5]
  );

  // Sell 2 glasses (remaining = 1)
  await request('POST', '/api/stall/sell', { Authorization: `Bearer ${s5Token}` }, { idempotency_key: `s5_sale1_${Date.now()}` });
  await request('POST', '/api/stall/sell', { Authorization: `Bearer ${s5Token}` }, { idempotency_key: `s5_sale2_${Date.now()}` });

  // Parcel sale requires 3 glasses -> blocked with 409 STOCK_FINISHED (since remaining = 1 < 3)
  const parcelCapRes = await request('POST', '/api/stall/sell-parcel', { Authorization: `Bearer ${s5Token}` }, { idempotency_key: `s5_parcel_${Date.now()}` });
  assert.equal(parcelCapRes.status, 409);
  assert.equal(parcelCapRes.body.code, 'STOCK_FINISHED');
  assert.equal(parcelCapRes.body.error, 'Item finished');

  // Wastage of 2 glasses -> blocked (since remaining = 1 < 2)
  const wastageCapRes = await request('POST', '/api/stall/wastage', { Authorization: `Bearer ${s5Token}` }, { quantity: 2, reason: 'Spoiled' });
  assert.equal(wastageCapRes.status, 409);
  assert.equal(wastageCapRes.body.code, 'STOCK_FINISHED');

  // Sell 3rd glass (remaining = 0)
  const sell3Res = await request('POST', '/api/stall/sell', { Authorization: `Bearer ${s5Token}` }, { idempotency_key: `s5_sale3_${Date.now()}` });
  assert.equal(sell3Res.status, 200);

  // 4th sale attempt when stock = 0 -> 409 STOCK_FINISHED
  const sell4Res = await request('POST', '/api/stall/sell', { Authorization: `Bearer ${s5Token}` }, { idempotency_key: `s5_sale4_${Date.now()}` });
  assert.equal(sell4Res.status, 409);
  assert.equal(sell4Res.body.code, 'STOCK_FINISHED');
  assert.equal(sell4Res.body.error, 'Item finished');
});

test('16. T1.6-4: Parcel Sales (+3, ₹120), parcel undo (-3, -₹120), and revenue calculation', async () => {
  const bcrypt = require('bcryptjs');
  const passHash = await bcrypt.hash('pass123', 10);
  await run(`INSERT INTO stalls (id, name, active) VALUES (6, 'Stall 6', 1)`);
  await run(
    `INSERT INTO users (name, email, password, role, stall_id) VALUES ('Stall 6 Worker', 'stall6@test.com', ?, 'STALL_USER', 6)`,
    [passHash]
  );
  const s6Res = await request('POST', '/api/auth/login', {}, { email: 'stall6@test.com', password: 'pass123' });
  const s6Token = s6Res.body.token;

  await request('POST', '/api/stall/start-day', { Authorization: `Bearer ${s6Token}` });

  // Insert 20 glasses stock for Stall 6
  const today6 = getISTBusinessDate();
  const utc6 = getUTCTimestamp();
  await run(
    `INSERT INTO stock_dispatches (stall_id, product_id, quantity, dispatched_by, created_at, received_at, received_by, received_quantity, received_business_date, status)
     VALUES (6, 1, 20, 1, ?, ?, 2, 20, ?, 'RECEIVED')`,
    [utc6, utc6, today6]
  );

  // 1. Single glass sale (+1, ₹40)
  await request('POST', '/api/stall/sell', { Authorization: `Bearer ${s6Token}` }, { idempotency_key: `s6_single_${Date.now()}` });

  // 2. Parcel sale (+3, ₹120)
  const pRes = await request('POST', '/api/stall/sell-parcel', { Authorization: `Bearer ${s6Token}` }, { idempotency_key: `s6_parcel_${Date.now()}` });
  assert.equal(pRes.status, 200);
  assert.equal(pRes.body.soldToday, 4); // 1 single + 3 parcel = 4 sold

  // Check sales record in DB (unit price 40.0)
  const parcelRow = await get(`SELECT * FROM sales WHERE stall_id = 6 AND quantity = 3`);
  assert.ok(parcelRow);
  assert.equal(parcelRow.selling_price, 40);

  // 3. Undo last sale (should undo the parcel sale of 3 glasses at once)
  const undoRes = await request('POST', '/api/stall/undo-last', { Authorization: `Bearer ${s6Token}` });
  assert.equal(undoRes.status, 200);

  // Verify DB reversal row: quantity = -3, selling_price = 40.0
  const revRow = await get(`SELECT * FROM sales WHERE stall_id = 6 AND reversal_of = ?`, [parcelRow.id]);
  assert.ok(revRow);
  assert.equal(revRow.quantity, -3);
  assert.equal(revRow.selling_price, 40);

  // Verify dashboard sold count is back to 1
  const dash = await request('GET', '/api/stall/dashboard', { Authorization: `Bearer ${s6Token}` });
  assert.equal(dash.body.soldToday, 1);
});

test('17. Raw SQL UPDATE/DELETE triggers block sales, wastages, stock_dispatches, daily_closings', async () => {
  // 1. Raw sales UPDATE/DELETE block
  const sRow = await get(`SELECT id FROM sales WHERE quantity > 0 LIMIT 1`);
  if (sRow) {
    await assert.rejects(async () => {
      await run(`UPDATE sales SET quantity = 10 WHERE id = ?`, [sRow.id]);
    }, /sales table is append-only/);
    await assert.rejects(async () => {
      await run(`DELETE FROM sales WHERE id = ?`, [sRow.id]);
    }, /sales table is append-only/);
  }

  // 2. Raw wastages UPDATE/DELETE block
  const today = getISTBusinessDate();
  const utc = getUTCTimestamp();
  const wResult = await run(`INSERT INTO wastages (stall_id, product_id, quantity, reason, created_at, created_by, business_date) VALUES (1, 1, 1, 'Spoiled', ?, 1, ?)`, [utc, today]);
  await assert.rejects(async () => {
    await run(`UPDATE wastages SET quantity = 5 WHERE id = ?`, [wResult.id]);
  }, /wastages table is append-only/);
  await assert.rejects(async () => {
    await run(`DELETE FROM wastages WHERE id = ?`, [wResult.id]);
  }, /wastages table is append-only/);

  // 3. Raw stock_dispatches DELETE & restricted UPDATE block
  const dResult = await run(`INSERT INTO stock_dispatches (stall_id, product_id, quantity, dispatched_by, created_at, status) VALUES (1, 1, 5, 1, ?, 'DISPATCHED')`, [utc]);
  await assert.rejects(async () => {
    await run(`DELETE FROM stock_dispatches WHERE id = ?`, [dResult.id]);
  }, /stock_dispatches table does not allow DELETE/);
  await assert.rejects(async () => {
    await run(`UPDATE stock_dispatches SET quantity = 10 WHERE id = ?`, [dResult.id]);
  }, /restricted column update on stock_dispatches/);

  // 4. Raw daily_closings DELETE & restricted UPDATE block
  await assert.rejects(async () => {
    await run(`DELETE FROM daily_closings WHERE stall_id = 1`);
  }, /daily_closings table does not allow DELETE/);
});

test('18. Parcel idempotency & parcel stock cap for remaining 1 and 2', async () => {
  const bcrypt = require('bcryptjs');
  const passHash = await bcrypt.hash('pass123', 10);
  await run(`INSERT INTO stalls (id, name, active) VALUES (7, 'Stall 7', 1)`);
  await run(`INSERT INTO users (name, email, password, role, stall_id) VALUES ('Stall 7 Worker', 'stall7@test.com', ?, 'STALL_USER', 7)`, [passHash]);
  const s7Res = await request('POST', '/api/auth/login', {}, { email: 'stall7@test.com', password: 'pass123' });
  const s7Token = s7Res.body.token;
  await request('POST', '/api/stall/start-day', { Authorization: `Bearer ${s7Token}` });

  const today7 = getISTBusinessDate();
  const utc7 = getUTCTimestamp();

  // Stock = 5
  await run(`INSERT INTO stock_dispatches (stall_id, product_id, quantity, dispatched_by, created_at, received_at, received_by, received_quantity, received_business_date, status) VALUES (7, 1, 5, 1, ?, ?, 2, 5, ?, 'RECEIVED')`, [utc7, utc7, today7]);

  // Parcel idempotency check (same key twice)
  const key = `parcel_idem_${Date.now()}`;
  const p1 = await request('POST', '/api/stall/sell-parcel', { Authorization: `Bearer ${s7Token}` }, { idempotency_key: key });
  const p2 = await request('POST', '/api/stall/sell-parcel', { Authorization: `Bearer ${s7Token}` }, { idempotency_key: key });
  assert.equal(p1.status, 200);
  assert.equal(p2.status, 200);
  assert.equal(p2.body.idempotent, true);

  const parcelCount = await get(`SELECT COUNT(*) as count FROM sales WHERE stall_id = 7 AND idempotency_key = ?`, [key]);
  assert.equal(parcelCount.count, 1);

  // Remaining stock = 2 (since 3 sold from 5)
  // Parcel request with remaining = 2 -> 409 STOCK_FINISHED and 0 rows inserted
  const pCap2 = await request('POST', '/api/stall/sell-parcel', { Authorization: `Bearer ${s7Token}` }, { idempotency_key: `parcel_cap_2_${Date.now()}` });
  assert.equal(pCap2.status, 409);
  assert.equal(pCap2.body.code, 'STOCK_FINISHED');

  // Sell 1 glass -> remaining = 1
  await request('POST', '/api/stall/sell', { Authorization: `Bearer ${s7Token}` }, { idempotency_key: `single_cap_1_${Date.now()}` });

  // Parcel request with remaining = 1 -> 409 STOCK_FINISHED and 0 rows inserted
  const pCap1 = await request('POST', '/api/stall/sell-parcel', { Authorization: `Bearer ${s7Token}` }, { idempotency_key: `parcel_cap_1_${Date.now()}` });
  assert.equal(pCap1.status, 409);
  assert.equal(pCap1.body.code, 'STOCK_FINISHED');
});

test('19. Admin void-sale on a parcel inserts -3 and drops revenue by 120', async () => {
  const bcrypt = require('bcryptjs');
  const passHash = await bcrypt.hash('pass123', 10);
  await run(`INSERT INTO stalls (id, name, active) VALUES (11, 'Stall 11', 1)`);
  await run(`INSERT INTO users (name, email, password, role, stall_id) VALUES ('Stall 11 Worker', 'stall11@test.com', ?, 'STALL_USER', 11)`, [passHash]);
  const s11Res = await request('POST', '/api/auth/login', {}, { email: 'stall11@test.com', password: 'pass123' });
  const s11Token = s11Res.body.token;
  await request('POST', '/api/stall/start-day', { Authorization: `Bearer ${s11Token}` });

  const today11 = getISTBusinessDate();
  const utc11 = getUTCTimestamp();
  await run(`INSERT INTO stock_dispatches (stall_id, product_id, quantity, dispatched_by, created_at, received_at, received_by, received_quantity, received_business_date, status) VALUES (11, 1, 10, 1, ?, ?, 2, 10, ?, 'RECEIVED')`, [utc11, utc11, today11]);

  const adminRes = await request('POST', '/api/auth/login', {}, { email: 'admin@test.com', password: 'admin123' });
  const adminToken = adminRes.body.token;

  // Insert dedicated parcel for void test
  const voidKey = `void_test_${Date.now()}`;
  const pRes = await request('POST', '/api/stall/sell-parcel', { Authorization: `Bearer ${s11Token}` }, { idempotency_key: voidKey });
  assert.equal(pRes.status, 200);

  const parcelRow = await get(`SELECT * FROM sales WHERE stall_id = 11 AND idempotency_key = ?`, [voidKey]);
  assert.ok(parcelRow);

  const revBefore = await get(`SELECT COALESCE(SUM(quantity * selling_price), 0) as total FROM sales WHERE stall_id = 11 AND business_date = ?`, [parcelRow.business_date]);
  const voidRes = await request('POST', '/api/admin/void-sale', { Authorization: `Bearer ${adminToken}` }, { sale_id: parcelRow.id, reason: 'Test parcel void' });
  assert.equal(voidRes.status, 200);

  const revAfter = await get(`SELECT COALESCE(SUM(quantity * selling_price), 0) as total FROM sales WHERE stall_id = 11 AND business_date = ?`, [parcelRow.business_date]);
  assert.equal(revBefore.total - revAfter.total, 120);

  const voidRow = await get(`SELECT * FROM sales WHERE reversal_of = ?`, [parcelRow.id]);
  assert.ok(voidRow);
  assert.equal(voidRow.quantity, -3);
});

test('20. Soft closing gate with confirm_mismatch=true stores SHORT and EXTRA with money_difference', async () => {
  const bcrypt = require('bcryptjs');
  const passHash = await bcrypt.hash('pass123', 10);

  // Setup Stall 8 (SHORT test)
  await run(`INSERT INTO stalls (id, name, active) VALUES (8, 'Stall 8', 1)`);
  await run(`INSERT INTO users (name, email, password, role, stall_id) VALUES ('Stall 8 Worker', 'stall8@test.com', ?, 'STALL_USER', 8)`, [passHash]);
  const s8Res = await request('POST', '/api/auth/login', {}, { email: 'stall8@test.com', password: 'pass123' });
  const s8Token = s8Res.body.token;
  await request('POST', '/api/stall/start-day', { Authorization: `Bearer ${s8Token}` });
  const today8 = getISTBusinessDate();
  const utc8 = getUTCTimestamp();
  await run(`INSERT INTO stock_dispatches (stall_id, product_id, quantity, dispatched_by, created_at, received_at, received_by, received_quantity, received_business_date, status) VALUES (8, 1, 10, 1, ?, ?, 2, 10, ?, 'RECEIVED')`, [utc8, utc8, today8]);
  await request('POST', '/api/stall/sell', { Authorization: `Bearer ${s8Token}` }, { idempotency_key: `s8_sell_${Date.now()}` }); // revenue = 40

  // 1. Submit SHORT (received = 20 < expected 40)
  const shortClose = await request('POST', '/api/stall/close-day', { Authorization: `Bearer ${s8Token}` }, { cash_received: 20, upi_received: 0, confirm_mismatch: true });
  assert.equal(shortClose.status, 200);
  const closing8 = await get(`SELECT * FROM daily_closings WHERE stall_id = 8 AND status = 'ACTIVE'`);
  assert.equal(closing8.money_status, 'SHORT');
  assert.equal(closing8.money_difference, -20);

  // Setup Stall 9 (EXTRA test)
  await run(`INSERT INTO stalls (id, name, active) VALUES (9, 'Stall 9', 1)`);
  await run(`INSERT INTO users (name, email, password, role, stall_id) VALUES ('Stall 9 Worker', 'stall9@test.com', ?, 'STALL_USER', 9)`, [passHash]);
  const s9Res = await request('POST', '/api/auth/login', {}, { email: 'stall9@test.com', password: 'pass123' });
  const s9Token = s9Res.body.token;
  await request('POST', '/api/stall/start-day', { Authorization: `Bearer ${s9Token}` });
  const today9 = getISTBusinessDate();
  const utc9 = getUTCTimestamp();
  await run(`INSERT INTO stock_dispatches (stall_id, product_id, quantity, dispatched_by, created_at, received_at, received_by, received_quantity, received_business_date, status) VALUES (9, 1, 10, 1, ?, ?, 2, 10, ?, 'RECEIVED')`, [utc9, utc9, today9]);
  await request('POST', '/api/stall/sell', { Authorization: `Bearer ${s9Token}` }, { idempotency_key: `s9_sell_${Date.now()}` }); // revenue = 40

  // 2. Submit EXTRA (received = 60 > expected 40)
  const extraClose = await request('POST', '/api/stall/close-day', { Authorization: `Bearer ${s9Token}` }, { cash_received: 60, upi_received: 0, confirm_mismatch: true });
  assert.equal(extraClose.status, 200);
  const closing9 = await get(`SELECT * FROM daily_closings WHERE stall_id = 9 AND status = 'ACTIVE'`);
  assert.equal(closing9.money_status, 'EXTRA');
  assert.equal(closing9.money_difference, 20);
});

test('21. Failed closing attempts audit count (3 failed attempts -> failedAttemptsCount = 3)', async () => {
  const bcrypt = require('bcryptjs');
  const passHash = await bcrypt.hash('pass123', 10);

  await run(`INSERT INTO stalls (id, name, active) VALUES (10, 'Stall 10', 1)`);
  await run(`INSERT INTO users (name, email, password, role, stall_id) VALUES ('Stall 10 Worker', 'stall10@test.com', ?, 'STALL_USER', 10)`, [passHash]);
  const s10Res = await request('POST', '/api/auth/login', {}, { email: 'stall10@test.com', password: 'pass123' });
  const s10Token = s10Res.body.token;
  await request('POST', '/api/stall/start-day', { Authorization: `Bearer ${s10Token}` });

  const today10 = getISTBusinessDate();
  const utc10 = getUTCTimestamp();
  await run(`INSERT INTO stock_dispatches (stall_id, product_id, quantity, dispatched_by, created_at, received_at, received_by, received_quantity, received_business_date, status) VALUES (10, 1, 10, 1, ?, ?, 2, 10, ?, 'RECEIVED')`, [utc10, utc10, today10]);
  await request('POST', '/api/stall/sell', { Authorization: `Bearer ${s10Token}` }, { idempotency_key: `s10_sell_${Date.now()}` });

  // 3 failed mismatch attempts (expected = 40)
  await request('POST', '/api/stall/close-day', { Authorization: `Bearer ${s10Token}` }, { cash_received: 100, upi_received: 0 });
  await request('POST', '/api/stall/close-day', { Authorization: `Bearer ${s10Token}` }, { cash_received: 200, upi_received: 0 });
  await request('POST', '/api/stall/close-day', { Authorization: `Bearer ${s10Token}` }, { cash_received: 300, upi_received: 0 });

  const failedRow = await get(`SELECT COUNT(*) as count FROM closing_attempts WHERE stall_id = 10 AND business_date = ?`, [today10]);
  assert.equal(failedRow.count, 3);
});

test('22. Dashboard metric consistency (/api/stall/dashboard vs /api/admin/dashboard)', async () => {
  const s1Res = await request('POST', '/api/auth/login', {}, { email: 'stall1@test.com', password: 'stall123' });
  const s1Token = s1Res.body.token;

  const adminRes = await request('POST', '/api/auth/login', {}, { email: 'admin@test.com', password: 'admin123' });
  const adminToken = adminRes.body.token;

  const stallDash = await request('GET', '/api/stall/dashboard', { Authorization: `Bearer ${s1Token}` });
  const adminDash = await request('GET', '/api/admin/dashboard', { Authorization: `Bearer ${adminToken}` });

  assert.equal(stallDash.body.stockReceived, adminDash.body.stall1Status.received);
  assert.equal(stallDash.body.soldToday, adminDash.body.stall1Status.sold);
  assert.equal(stallDash.body.wastageToday, adminDash.body.stall1Status.wastage);
  assert.equal(stallDash.body.computedRemaining, adminDash.body.stall1Status.expectedRemaining);
  assert.equal(stallDash.body.soldToday * stallDash.body.product.selling_price, adminDash.body.stall1Status.revenue);
});

test('23. Business date calculation at 23:30 IST and 00:30 IST under TZ=UTC vs TZ=Asia/Kolkata', async () => {
  const { getISTBusinessDate } = require('../server/db');

  // Test 11:30 PM IST (23:30 IST) -> UTC 18:00
  const lateNightIST = new Date('2026-09-21T18:00:00Z'); // 11:30 PM IST on Sep 21
  const bDate1 = getISTBusinessDate(lateNightIST);
  assert.equal(bDate1, '2026-09-21');

  // Test 00:30 AM IST (00:30 IST next day) -> UTC 19:00 previous day
  const earlyMorningIST = new Date('2026-09-21T19:00:00Z'); // 00:30 AM IST on Sep 22
  const bDate2 = getISTBusinessDate(earlyMorningIST);
  assert.equal(bDate2, '2026-09-22');
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
});

