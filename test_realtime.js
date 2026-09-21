const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

// Clean test db
const dbPath = path.join(__dirname, 'data/payasam.db');
if (fs.existsSync(dbPath)) {
  try { fs.unlinkSync(dbPath); } catch (e) {}
}

const server = require('./server/index');

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

async function runRealtimeTest() {
  console.log('\n--- TESTING LIVE WEBSOCKET REAL-TIME SYNCHRONIZATION ---\n');

  await new Promise(r => setTimeout(r, 1000));

  // 1. Log in admin & stall worker
  const adminLogin = await request('POST', '/api/auth/login', {}, { email: 'admin@test.com', password: 'admin123' });
  const stallLogin = await request('POST', '/api/auth/login', {}, { email: 'stall1@test.com', password: 'stall123' });

  const adminToken = adminLogin.body.token;
  const stallToken = stallLogin.body.token;

  console.log('✓ Admin and Stall 1 worker authenticated.');

  // 2. Connect Admin WebSocket
  console.log('\n2. Connecting Admin to WebSocket (/ws)...');
  const adminWs = new WebSocket('ws://localhost:5000/ws');
  const receivedAdminEvents = [];

  await new Promise((resolve) => {
    adminWs.on('open', () => {
      adminWs.send(JSON.stringify({ type: 'REGISTER', role: 'ADMIN' }));
      console.log('✓ Admin WebSocket connected.');
      resolve();
    });
  });

  adminWs.on('message', (data) => {
    const parsed = JSON.parse(data.toString());
    receivedAdminEvents.push(parsed);
    console.log('  ⚡ [ADMIN WS RECEIVED EVENT]:', parsed.type, parsed.payload ? parsed.payload.text : parsed);
  });

  // 3. Connect Stall 1 WebSocket and send heartbeat
  console.log('\n3. Connecting Stall 1 Worker to WebSocket (/ws) & sending heartbeat...');
  const stallWs = new WebSocket('ws://localhost:5000/ws');

  await new Promise((resolve) => {
    stallWs.on('open', () => {
      stallWs.send(JSON.stringify({ type: 'REGISTER', role: 'STALL', stall_id: 1 }));
      stallWs.send(JSON.stringify({ type: 'HEARTBEAT', stall_id: 1 }));
      console.log('✓ Stall 1 WebSocket connected & sent heartbeat.');
      resolve();
    });
  });

  await new Promise(r => setTimeout(r, 500));

  // 4. Admin dispatches stock
  console.log('\n4. Admin dispatching 50 glasses...');
  await request('POST', '/api/admin/dispatch', { Authorization: `Bearer ${adminToken}` }, { stall_id: 1, quantity: 50 });

  // 5. Stall worker confirms receipt
  console.log('\n5. Stall worker confirming receipt...');
  await request('POST', '/api/stall/confirm-receipt', { Authorization: `Bearer ${stallToken}` }, {});

  // 6. Stall worker triggers SELL 1 API call
  console.log('\n6. Stall 1 worker pressing SELL 1...');
  const startTime = Date.now();
  await request('POST', '/api/stall/sell', { Authorization: `Bearer ${stallToken}` }, {});

  // Wait for event to arrive
  await new Promise(r => setTimeout(r, 500));

  const saleEvent = receivedAdminEvents.find(e => e.type === 'STALL_ACTION' && e.payload && e.payload.eventType === 'SALE');
  if (!saleEvent) {
    throw new Error('Admin did not receive real-time SELL 1 broadcast!');
  }
  console.log(`✓ Real-time SALE event received by Admin! Text: "${saleEvent.payload.text}"`);

  // 7. Check connection status in admin dashboard
  console.log('\n7. Checking Admin Dashboard Connection Status API...');
  const adminDash = await request('GET', '/api/admin/dashboard', { Authorization: `Bearer ${adminToken}` });
  console.log('   Stall 1 Online Status:', adminDash.body.stall1Status.isOnline ? '🟢 LIVE ONLINE' : '🔴 OFFLINE');
  console.log('   Last Sale Timestamp:', adminDash.body.stall1Status.lastSaleTime);

  if (!adminDash.body.stall1Status.isOnline) {
    throw new Error('Stall 1 should be reported as ONLINE');
  }

  // Close Sockets
  adminWs.close();
  stallWs.close();

  console.log('\n🎉 --- REAL-TIME WEBSOCKET SYNCHRONIZATION PASSED PERFECTLY! --- 🎉\n');
  process.exit(0);
}

runRealtimeTest().catch(err => {
  console.error('❌ REALTIME TEST FAILED:', err);
  process.exit(1);
});
