const http = require('http');
const path = require('path');
const fs = require('fs');

// Reset DB for clean test run
const dbPath = path.join(__dirname, 'data/payasam.db');
if (fs.existsSync(dbPath)) {
  try {
    fs.unlinkSync(dbPath);
    console.log('Cleaned previous DB for automated test.');
  } catch (e) {
    // ok
  }
}

// Start server
const app = require('./server/index');

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
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, body: parsed });
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

async function runE2ETest() {
  console.log('\n--- STARTING COLD PAYASAM E2E WORKFLOW TEST ---\n');

  // Wait 1s for db init
  await new Promise(r => setTimeout(r, 1000));

  // 1. Admin Login
  console.log('1. Admin Logging in (admin@test.com)...');
  const adminLogin = await request('POST', '/api/auth/login', {}, { email: 'admin@test.com', password: 'admin123' });
  if (adminLogin.status !== 200) throw new Error('Admin login failed');
  const adminToken = adminLogin.body.token;
  console.log('✓ Admin logged in successfully.');

  // 2. Admin Dispatches 50 glasses to Stall 1
  console.log('\n2. Admin dispatching 50 glasses to Stall 1...');
  const dispatchRes = await request('POST', '/api/admin/dispatch', { Authorization: `Bearer ${adminToken}` }, { stall_id: 1, quantity: 50 });
  if (dispatchRes.status !== 200) throw new Error('Dispatch failed');
  console.log('✓ Admin dispatch success:', dispatchRes.body.message);

  // 3. Stall Worker Login
  console.log('\n3. Stall Worker logging in (stall1@test.com)...');
  const stallLogin = await request('POST', '/api/auth/login', {}, { email: 'stall1@test.com', password: 'stall123' });
  if (stallLogin.status !== 200) throw new Error('Stall login failed');
  const stallToken = stallLogin.body.token;
  console.log('✓ Stall worker logged in successfully.');

  // 4. Stall Worker views dashboard & confirms receipt
  console.log('\n4. Stall Worker checking dashboard & confirming stock receipt...');
  let stallDash = await request('GET', '/api/stall/dashboard', { Authorization: `Bearer ${stallToken}` });
  console.log('   Pending Dispatches found:', stallDash.body.pendingDispatches.length);

  const confirmRes = await request('POST', '/api/stall/confirm-receipt', { Authorization: `Bearer ${stallToken}` }, {});
  if (confirmRes.status !== 200) throw new Error('Receipt confirmation failed');
  console.log('✓ Stock receipt confirmed by Stall 1 worker.');

  // Verify dashboard after receipt
  stallDash = await request('GET', '/api/stall/dashboard', { Authorization: `Bearer ${stallToken}` });
  console.log(`   Stock Received: ${stallDash.body.stockReceived} | Expected Remaining: ${stallDash.body.expectedRemaining}`);

  // 5. Worker presses SELL 1 button 37 times
  console.log('\n5. Worker pressing SELL 1 button 37 times...');
  for (let i = 1; i <= 37; i++) {
    const sellRes = await request('POST', '/api/stall/sell', { Authorization: `Bearer ${stallToken}` }, {});
    if (sellRes.status !== 200) throw new Error(`Sale #${i} failed`);
  }
  console.log('✓ 37 sales recorded via SELL 1.');

  // 6. Verify stall status after 37 sales
  stallDash = await request('GET', '/api/stall/dashboard', { Authorization: `Bearer ${stallToken}` });
  console.log('\n6. Verifying Stall Stock & Revenue Calculation:');
  console.log(`   Received Stock: ${stallDash.body.stockReceived}`);
  console.log(`   Sold Today: ${stallDash.body.soldToday}`);
  console.log(`   Expected Remaining Stock: ${stallDash.body.expectedRemaining}`);
  console.log(`   Today's Expected Revenue: ₹${stallDash.body.expectedRevenue}`);

  if (stallDash.body.soldToday !== 37) throw new Error(`Expected 37 sold, got ${stallDash.body.soldToday}`);
  if (stallDash.body.expectedRemaining !== 13) throw new Error(`Expected 13 remaining, got ${stallDash.body.expectedRemaining}`);
  if (stallDash.body.expectedRevenue !== 1480) throw new Error(`Expected ₹1480 revenue, got ₹${stallDash.body.expectedRevenue}`);

  // 7. Worker closes the day with Cash ₹800 + UPI ₹680 = ₹1,480
  console.log('\n7. Stall Worker closing day with Cash = ₹800, UPI = ₹680...');
  const closingRes = await request('POST', '/api/stall/close-day', { Authorization: `Bearer ${stallToken}` }, {
    actual_remaining: 13,
    cash_received: 800,
    upi_received: 680
  });
  if (closingRes.status !== 200) throw new Error('Close day failed');
  console.log('✓ Day closed successfully. Discrepancy:', closingRes.body.closing.discrepancy);

  // 8. Admin checks Money & Reports
  console.log('\n8. Admin checking Money Reconciliation & Financial Reports...');
  const moneyRes = await request('GET', '/api/admin/money', { Authorization: `Bearer ${adminToken}` });
  console.log(`   Status: ${moneyRes.body.statusLabel} | Discrepancy: ₹${moneyRes.body.discrepancy}`);
  console.log(`   Expected: ₹${moneyRes.body.expectedRevenue} | Total Received: ₹${moneyRes.body.totalReceived}`);

  const reportRes = await request('GET', '/api/admin/reports', { Authorization: `Bearer ${adminToken}` });
  console.log(`   Report - Glasses Sold: ${reportRes.body.totalGlassesSold}`);
  console.log(`   Report - Total Revenue: ₹${reportRes.body.totalRevenue}`);
  console.log(`   Report - Direct Product Cost: ₹${reportRes.body.totalProductCost}`);
  console.log(`   Report - Estimated Operating Profit: ₹${reportRes.body.estimatedOperatingProfit}`);

  console.log('\n🎉 --- ALL E2E WORKFLOW TESTS PASSED PERFECTLY! --- 🎉\n');
  process.exit(0);
}

runE2ETest().catch(err => {
  console.error('❌ E2E TEST FAILED:', err);
  process.exit(1);
});
