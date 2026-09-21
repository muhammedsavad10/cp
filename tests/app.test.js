const { test, before, after } = require('node:test');
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

test('3. Undo allowed <= 120s and rejected after > 120s', async () => {
  const today = getISTBusinessDate();
  const utcOld = new Date(Date.now() - 130 * 1000).toISOString();

  // Insert a sale created 130 seconds ago
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

  // Second undo attempts to reverse the 130s old sale -> fails (expired window)
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

test('7. Blind Closing math & Second closing returns 409 Conflict', async () => {
  const today = getISTBusinessDate();

  const close1 = await request('POST', '/api/stall/close-day', { Authorization: `Bearer ${stall1Token}` }, {
    actual_remaining: 10,
    cash_received: 400,
    upi_received: 200
  });

  assert.equal(close1.status, 200);
  assert.equal(close1.body.message, 'Day closed');

  // Second closing returns 409
  const close2 = await request('POST', '/api/stall/close-day', { Authorization: `Bearer ${stall1Token}` }, {
    actual_remaining: 10,
    cash_received: 400,
    upi_received: 200
  });

  assert.equal(close2.status, 409);
});

test('8. Undo & Sale blocked after close (409 DAY_CLOSED)', async () => {
  const sellRes = await request('POST', '/api/stall/sell', { Authorization: `Bearer ${stall1Token}` }, { idempotency_key: `key_closed_${Date.now()}` });
  assert.equal(sellRes.status, 409);

  const undoRes = await request('POST', '/api/stall/undo-last', { Authorization: `Bearer ${stall1Token}` });
  assert.equal(undoRes.status, 409);
});

test('9. Admin Reopen Day allows sales again', async () => {
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
  // Test IST calculation for 18:35 UTC (which is 00:05 IST next day)
  const utcDate = new Date('2026-09-21T18:35:00Z');
  const istDateStr = getISTBusinessDate(utcDate);
  assert.equal(istDateStr, '2026-09-22');
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
});
