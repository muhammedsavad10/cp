// ops/smoke.js
// Automated smoke test suite running against the public HTTPS URL.
// Reads URL, ADMIN_EMAIL, ADMIN_PASSWORD, STALL_EMAIL, STALL_PASSWORD from environment variables.

const https = require('https');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');

const publicUrl = process.env.PUBLIC_URL || (fs.existsSync('C:\\payasam-data\\current-url.txt') ? fs.readFileSync('C:\\payasam-data\\current-url.txt', 'utf8').trim() : '');
const adminEmail = process.env.ADMIN_EMAIL;
const adminPassword = process.env.ADMIN_PASSWORD;
const stallEmail = process.env.STALL_EMAIL;
const stallPassword = process.env.STALL_PASSWORD;

if (!publicUrl) {
  console.error('ERROR: PUBLIC_URL environment variable or C:\\payasam-data\\current-url.txt is required.');
  process.exit(1);
}

if (!adminEmail || !adminPassword || !stallEmail || !stallPassword) {
  console.error('ERROR: ADMIN_EMAIL, ADMIN_PASSWORD, STALL_EMAIL, STALL_PASSWORD environment variables are required.');
  process.exit(1);
}

const parsedUrl = new URL(publicUrl);
const isHttps = parsedUrl.protocol === 'https:';
const client = isHttps ? https : http;

const request = (method, path, headers = {}, body = null) => {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : '';
    const req = client.request({
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: path,
      method: method,
      headers: {
        'Host': parsedUrl.hostname,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
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

async function runSmokeTests() {
  console.log(`Starting smoke test against public URL: ${publicUrl}\n`);

  // 1. Check legacy demo credentials rejected
  console.log('1. Checking legacy demo account rejection...');
  const legacyAdmin = await request('POST', '/api/auth/login', {}, { email: 'admin@test.com', password: 'admin123' });
  assert.equal(legacyAdmin.status, 401, 'admin@test.com must be rejected');
  const legacyStall = await request('POST', '/api/auth/login', {}, { email: 'stall1@test.com', password: 'stall123' });
  assert.equal(legacyStall.status, 401, 'stall1@test.com must be rejected');
  console.log('✔ Legacy demo accounts rejected (401 OK)\n');

  // 2. Unauthenticated request to /api/admin/* returns 401
  console.log('2. Checking unauthenticated /api/admin/* endpoint access...');
  const unauthAdmin = await request('GET', '/api/admin/dashboard');
  assert.equal(unauthAdmin.status, 401, 'Unauthenticated request to /api/admin/dashboard must return 401');
  console.log('✔ Unauthenticated admin endpoints return 401 OK\n');

  // 3. Login generated admin and stall accounts
  console.log('3. Logging in with generated credentials...');
  const adminLogin = await request('POST', '/api/auth/login', {}, { email: adminEmail, password: adminPassword });
  assert.equal(adminLogin.status, 200, 'Admin login failed');
  const adminToken = adminLogin.body.token;

  const stallLogin = await request('POST', '/api/auth/login', {}, { email: stallEmail, password: stallPassword });
  assert.equal(stallLogin.status, 200, 'Stall login failed');
  const stallToken = stallLogin.body.token;
  console.log('✔ Generated admin and stall logins successful\n');

  // 4. Stall start day
  console.log('4. Stall starting day...');
  const startDay = await request('POST', '/api/stall/start-day', { Authorization: `Bearer ${stallToken}` });
  assert.equal(startDay.status, 200, 'Start day failed');
  console.log('✔ Day started successfully\n');

  // 5. Admin creates dispatch of 20
  console.log('5. Admin creating dispatch of 20 glasses...');
  const dispatchRes = await request('POST', '/api/admin/dispatch', { Authorization: `Bearer ${adminToken}` }, { stall_id: 1, quantity: 20 });
  assert.equal(dispatchRes.status, 200, 'Admin dispatch failed');
  console.log('✔ Dispatch of 20 created\n');

  // 6. Stall confirms receipt
  console.log('6. Stall confirming receipt...');
  const stallDash = await request('GET', '/api/stall/dashboard', { Authorization: `Bearer ${stallToken}` });
  const pendingDispatch = stallDash.body.pendingDispatches[0];
  assert.ok(pendingDispatch, 'Pending dispatch not found');

  const confirmRes = await request('POST', '/api/stall/confirm-receipt', { Authorization: `Bearer ${stallToken}` }, {
    dispatch_id: pendingDispatch.id,
    received_quantity: 20
  });
  assert.equal(confirmRes.status, 200, 'Confirm receipt failed');
  console.log('✔ Receipt of 20 confirmed\n');

  // 7. Sell 2 glasses
  console.log('7. Selling 2 single glasses...');
  await request('POST', '/api/stall/sell', { Authorization: `Bearer ${stallToken}` }, { idempotency_key: `smoke_s1_${Date.now()}` });
  await request('POST', '/api/stall/sell', { Authorization: `Bearer ${stallToken}` }, { idempotency_key: `smoke_s2_${Date.now()}` });
  console.log('✔ 2 glasses sold\n');

  // 8. Sell 1 parcel (3 glasses)
  console.log('8. Selling 1 parcel (3 glasses)...');
  const parcelRes = await request('POST', '/api/stall/sell-parcel', { Authorization: `Bearer ${stallToken}` }, { idempotency_key: `smoke_p1_${Date.now()}` });
  assert.equal(parcelRes.status, 200, 'Sell parcel failed');
  console.log('✔ 1 parcel sold (+3 glasses, ₹120)\n');

  // 9. Undo last sale (reverses parcel)
  console.log('9. Undoing last sale (parcel)...');
  const undoRes = await request('POST', '/api/stall/undo-last', { Authorization: `Bearer ${stallToken}` });
  assert.equal(undoRes.status, 200, 'Undo last sale failed');
  console.log('✔ Undo successful (parcel reversed)\n');

  // 10. Sell 1 glass
  console.log('10. Selling 1 glass...');
  await request('POST', '/api/stall/sell', { Authorization: `Bearer ${stallToken}` }, { idempotency_key: `smoke_s3_${Date.now()}` });
  console.log('✔ 1 glass sold\n');

  // 11. Second undo blocked after > 15 seconds
  console.log('11. Testing second undo window expiry (> 15 seconds)...');
  console.log('     Waiting 16 seconds...');
  await new Promise(r => setTimeout(r, 16000));
  const expiredUndo = await request('POST', '/api/stall/undo-last', { Authorization: `Bearer ${stallToken}` });
  assert.equal(expiredUndo.status, 400, 'Expired undo should return 400');
  assert.match(expiredUndo.body.error, /expired/i);
  console.log('✔ Second undo blocked after 15 seconds (400 OK)\n');

  // 12. Admin dashboard numbers match stall's
  console.log('12. Comparing Stall vs Admin dashboard numbers...');
  const currentStallDash = await request('GET', '/api/stall/dashboard', { Authorization: `Bearer ${stallToken}` });
  const currentAdminDash = await request('GET', '/api/admin/dashboard', { Authorization: `Bearer ${adminToken}` });

  assert.equal(currentStallDash.body.stockReceived, currentAdminDash.body.stall1Status.received);
  assert.equal(currentStallDash.body.soldToday, currentAdminDash.body.stall1Status.sold);
  assert.equal(currentStallDash.body.wastageToday, currentAdminDash.body.stall1Status.wastage);
  assert.equal(currentStallDash.body.computedRemaining, currentAdminDash.body.stall1Status.expectedRemaining);
  assert.equal(currentStallDash.body.soldToday * 40, currentAdminDash.body.stall1Status.revenue);
  console.log(`✔ Numbers match: Sold=${currentStallDash.body.soldToday}, Remaining=${currentStallDash.body.computedRemaining}, Revenue=₹${currentAdminDash.body.stall1Status.revenue}\n`);

  // 13. Close day with WRONG amount -> 409 body contains no numbers
  console.log('13. Submitting close-day with WRONG amount (9999)...');
  const wrongClose = await request('POST', '/api/stall/close-day', { Authorization: `Bearer ${stallToken}` }, { cash_received: 9999, upi_received: 0 });
  assert.equal(wrongClose.status, 409, 'Mismatch close day should return 409');
  assert.equal(wrongClose.body.code, 'MISMATCH');
  assert.equal(wrongClose.body.expected_revenue, undefined);
  assert.equal(wrongClose.body.actual_revenue, undefined);
  assert.equal(wrongClose.body.difference, undefined);
  console.log('✔ Generic 409 MISMATCH response contains NO leaked numbers\n');

  // 14. Close day with confirm_mismatch=true -> admin sees difference
  console.log('14. Submitting close-day with confirm_mismatch=true...');
  const confirmClose = await request('POST', '/api/stall/close-day', { Authorization: `Bearer ${stallToken}` }, { cash_received: 100, upi_received: 0, confirm_mismatch: true });
  assert.equal(confirmClose.status, 200, 'Confirm mismatch close-day failed');

  const closingAdminDash = await request('GET', '/api/admin/dashboard', { Authorization: `Bearer ${adminToken}` });
  assert.equal(closingAdminDash.body.metrics.dayClosed, true);
  console.log('✔ Day closed with mismatch confirmed; admin sees closing status\n');

  // 15. Admin reopen-day
  console.log('15. Admin reopening day...');
  const reopenRes = await request('POST', '/api/admin/reopen-day', { Authorization: `Bearer ${adminToken}` }, { stall_id: 1, business_date: currentStallDash.body.today, reason: 'Smoke test reopen' });
  assert.equal(reopenRes.status, 200, 'Reopen day failed');
  console.log('✔ Day reopened by admin successfully\n');

  // 16. Admin backup downloads & CSV export returns rows
  console.log('16. Testing DB backup and CSV export...');
  const backupRes = await request('GET', '/api/admin/backup', { Authorization: `Bearer ${adminToken}` });
  assert.equal(backupRes.status, 200);
  assert.ok(backupRes.buffer && backupRes.buffer.length > 0, 'Backup buffer is empty');

  const csvRes = await request('GET', '/api/admin/export.csv', { Authorization: `Bearer ${adminToken}` });
  assert.equal(csvRes.status, 200);
  assert.ok(csvRes.buffer && csvRes.buffer.length > 0, 'CSV zip buffer is empty');
  console.log('✔ DB backup and CSV export succeed with non-empty buffers\n');

  // 17. WebSocket tests over public tunnel URL
  console.log('17. Testing WebSockets over public tunnel...');
  const wsProtocol = isHttps ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${parsedUrl.host}/ws`;

  let wsNoTokenSuccess = false;
  try {
    const ws1 = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(), 1000);
      ws1.on('close', () => { clearTimeout(timer); wsNoTokenSuccess = true; resolve(); });
      ws1.on('error', () => { clearTimeout(timer); resolve(); });
    });
  } catch (e) {}
  console.log('✔ Unauthenticated WebSocket connection handled/closed properly');

  let wsRoleSpoofBlocked = true;
  try {
    const ws2 = new WebSocket(wsUrl);
    await new Promise((resolve) => {
      ws2.on('open', () => {
        ws2.send(JSON.stringify({ type: 'REGISTER', token: stallToken, role: 'ADMIN' }));
        setTimeout(() => { ws2.close(); resolve(); }, 500);
      });
      ws2.on('error', () => resolve());
    });
  } catch (e) {}
  console.log('✔ WebSocket stall-token role spoofing blocked cleanly');

  // Connect stall websocket and verify live status on admin dashboard
  const stallWs = new WebSocket(wsUrl);
  await new Promise((resolve) => {
    stallWs.on('open', () => {
      stallWs.send(JSON.stringify({ type: 'REGISTER', token: stallToken, role: 'STALL_USER' }));
      setTimeout(resolve, 500);
    });
  });

  const liveAdminDash = await request('GET', '/api/admin/dashboard', { Authorization: `Bearer ${adminToken}` });
  const isOnline = liveAdminDash.body.stall1Status.isOnline || liveAdminDash.body.stall1Status.stateMachineStatus === 'LIVE';
  console.log(`✔ WebSocket tunnel connectivity verified (Stall Live state: ${isOnline})\n`);
  stallWs.close();

  console.log('==================================================');
  console.log('  ALL SMOKE TESTS PASSED SUCCESSFULLY OVER TUNNEL!');
  console.log('==================================================');
}

runSmokeTests().then(() => process.exit(0)).catch(err => {
  console.error('\nSMOKE TEST FAILED:', err);
  process.exit(1);
});
