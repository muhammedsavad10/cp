const express = require('express');
const router = express.Router();
const { get, all, run } = require('../db');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { getStallStatus, broadcastEvent } = require('../websocket');

const getTodayDateString = () => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Protect all admin routes
router.use(authenticateToken);
router.use(requireRole('ADMIN'));

// GET /api/admin/dashboard
router.get('/dashboard', async (req, res) => {
  try {
    const today = getTodayDateString();

    const product = await get('SELECT * FROM products WHERE id = 1');
    const price = product ? product.selling_price : 40.0;

    // Sales today
    const salesRow = await get(
      `SELECT COALESCE(SUM(quantity), 0) as total FROM sales WHERE DATE(created_at, 'localtime') = DATE('now', 'localtime')`
    );
    const totalSold = salesRow ? salesRow.total : 0;
    const totalRevenue = totalSold * price;

    // Last sale timestamp
    const lastSale = await get(
      `SELECT created_at FROM sales WHERE stall_id = 1 ORDER BY id DESC LIMIT 1`
    );

    // Stock received today
    const stockRow = await get(
      `SELECT COALESCE(SUM(quantity), 0) as total FROM stock_dispatches WHERE status = 'RECEIVED' AND DATE(created_at, 'localtime') = DATE('now', 'localtime')`
    );
    const totalStockReceived = stockRow ? stockRow.total : 0;

    // Wastage today
    const wastageRow = await get(
      `SELECT COALESCE(SUM(quantity), 0) as total FROM wastages WHERE DATE(created_at, 'localtime') = DATE('now', 'localtime')`
    );
    const totalWastage = wastageRow ? wastageRow.total : 0;

    const expectedRemaining = totalStockReceived - totalSold - totalWastage;

    // Closing data
    const closing = await get(
      `SELECT * FROM daily_closings WHERE stall_id = 1 AND date = ?`,
      [today]
    );

    // Connection status from websocket manager
    const connStatus = getStallStatus(1);

    // Recent activity (sales, dispatches, receipts, wastage, daily closings)
    const salesList = await all(
      `SELECT 'SALE' as type, id, 'Stall 1 sold 1 Butter Fruit Payasam' as description, created_at, quantity * selling_price as value 
       FROM sales WHERE DATE(created_at, 'localtime') = DATE('now', 'localtime') 
       ORDER BY id DESC LIMIT 15`
    );

    const dispatchList = await all(
      `SELECT 'DISPATCH' as type, id, ('Stall 1 stock dispatched: ' || quantity || ' glasses') as description, created_at, quantity as value 
       FROM stock_dispatches WHERE DATE(created_at, 'localtime') = DATE('now', 'localtime') 
       ORDER BY id DESC LIMIT 15`
    );

    const receiptList = await all(
      `SELECT 'RECEIPT' as type, id, ('Stall 1 confirmed receipt of ' || quantity || ' glasses') as description, received_at as created_at, quantity as value 
       FROM stock_dispatches WHERE status = 'RECEIVED' AND DATE(received_at, 'localtime') = DATE('now', 'localtime') 
       ORDER BY id DESC LIMIT 15`
    );

    const wastageList = await all(
      `SELECT 'WASTAGE' as type, id, ('Stall 1 recorded ' || quantity || ' wastage (' || reason || ')') as description, created_at, quantity as value 
       FROM wastages WHERE DATE(created_at, 'localtime') = DATE('now', 'localtime') 
       ORDER BY id DESC LIMIT 15`
    );

    const closingList = await all(
      `SELECT 'CLOSING' as type, id, ('Stall 1 submitted daily closing (Discrepancy: ₹' || discrepancy || ')') as description, submitted_at as created_at, total_received as value 
       FROM daily_closings WHERE date = ? 
       ORDER BY id DESC LIMIT 15`,
      [today]
    );

    const combinedActivity = [...salesList, ...dispatchList, ...receiptList, ...wastageList, ...closingList]
      .filter(item => item.created_at)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 20);

    return res.json({
      today,
      metrics: {
        totalSold,
        totalRevenue,
        totalStockReceived,
        totalWastage,
        expectedRemaining,
        actualRemaining: closing ? closing.actual_remaining : null,
        cashReceived: closing ? closing.cash_received : null,
        upiReceived: closing ? closing.upi_received : null,
        totalReceived: closing ? closing.total_received : null,
        discrepancy: closing ? closing.discrepancy : null,
        closingSubmitted: !!closing
      },
      stall1Status: {
        id: 1,
        name: 'Stall 1',
        received: totalStockReceived,
        sold: totalSold,
        wastage: totalWastage,
        expectedRemaining,
        revenue: totalRevenue,
        lastSaleTime: lastSale ? lastSale.created_at : null,
        isOnline: connStatus.isOnline,
        lastSeen: connStatus.lastSeen
      },
      recentActivity: combinedActivity
    });
  } catch (err) {
    console.error('Admin dashboard error:', err);
    return res.status(500).json({ error: 'Failed to fetch admin dashboard' });
  }
});

// POST /api/admin/dispatch
router.post('/dispatch', async (req, res) => {
  try {
    const { stall_id = 1, quantity = 50, product_id = 1 } = req.body;

    if (!quantity || quantity <= 0) {
      return res.status(400).json({ error: 'Valid dispatch quantity is required' });
    }

    await run(
      `INSERT INTO stock_dispatches (stall_id, product_id, quantity, dispatched_by, status)
       VALUES (?, ?, ?, ?, 'DISPATCHED')`,
      [stall_id, product_id, Number(quantity), req.user.id]
    );

    const nowIso = new Date().toISOString();

    // Broadcast Real-Time Event!
    broadcastEvent('STALL_ACTION', {
      eventType: 'DISPATCH',
      stall_id,
      stall_name: `Stall ${stall_id}`,
      quantity: Number(quantity),
      created_at: nowIso,
      text: `Admin dispatched ${quantity} glasses to Stall ${stall_id}`
    });

    return res.json({ success: true, message: `Successfully dispatched ${quantity} glasses to Stall ${stall_id}` });
  } catch (err) {
    console.error('Dispatch error:', err);
    return res.status(500).json({ error: 'Failed to dispatch stock' });
  }
});

// GET /api/admin/sales
router.get('/sales', async (req, res) => {
  try {
    const today = getTodayDateString();

    const sales = await all(
      `SELECT s.id, s.quantity, s.selling_price, s.created_at, p.name as product_name, u.name as user_name 
       FROM sales s
       JOIN products p ON s.product_id = p.id
       JOIN users u ON s.created_by = u.id
       WHERE DATE(s.created_at, 'localtime') = DATE('now', 'localtime')
       ORDER BY s.id DESC`
    );

    const product = await get('SELECT * FROM products WHERE id = 1');
    const price = product ? product.selling_price : 40.0;

    const totalSold = sales.reduce((acc, curr) => acc + curr.quantity, 0);
    const totalRevenue = totalSold * price;

    return res.json({
      today,
      totalSales: totalSold,
      totalRevenue,
      sales
    });
  } catch (err) {
    console.error('Admin sales error:', err);
    return res.status(500).json({ error: 'Failed to fetch sales log' });
  }
});

// GET /api/admin/stock
router.get('/stock', async (req, res) => {
  try {
    const today = getTodayDateString();

    const dispatches = await all(
      `SELECT d.*, u1.name as dispatched_by_name, u2.name as received_by_name, p.name as product_name 
       FROM stock_dispatches d
       JOIN products p ON d.product_id = p.id
       JOIN users u1 ON d.dispatched_by = u1.id
       LEFT JOIN users u2 ON d.received_by = u2.id
       WHERE DATE(d.created_at, 'localtime') = DATE('now', 'localtime')
       ORDER BY d.id DESC`
    );

    const receivedRow = await get(
      `SELECT COALESCE(SUM(quantity), 0) as total FROM stock_dispatches WHERE status = 'RECEIVED' AND DATE(created_at, 'localtime') = DATE('now', 'localtime')`
    );
    const totalReceived = receivedRow ? receivedRow.total : 0;

    const salesRow = await get(
      `SELECT COALESCE(SUM(quantity), 0) as total FROM sales WHERE DATE(created_at, 'localtime') = DATE('now', 'localtime')`
    );
    const totalSold = salesRow ? salesRow.total : 0;

    const wastageRow = await get(
      `SELECT COALESCE(SUM(quantity), 0) as total FROM wastages WHERE DATE(created_at, 'localtime') = DATE('now', 'localtime')`
    );
    const totalWastage = wastageRow ? wastageRow.total : 0;

    const expectedRemaining = totalReceived - totalSold - totalWastage;

    const closing = await get(
      `SELECT * FROM daily_closings WHERE stall_id = 1 AND date = ?`,
      [today]
    );

    return res.json({
      productName: 'Butter Fruit Payasam',
      totalReceived,
      totalSold,
      totalWastage,
      expectedRemaining,
      actualRemaining: closing ? closing.actual_remaining : null,
      dispatches
    });
  } catch (err) {
    console.error('Admin stock error:', err);
    return res.status(500).json({ error: 'Failed to fetch stock data' });
  }
});

// GET /api/admin/money
router.get('/money', async (req, res) => {
  try {
    const today = getTodayDateString();

    const product = await get('SELECT * FROM products WHERE id = 1');
    const price = product ? product.selling_price : 40.0;

    const salesRow = await get(
      `SELECT COALESCE(SUM(quantity), 0) as total FROM sales WHERE DATE(created_at, 'localtime') = DATE('now', 'localtime')`
    );
    const totalSold = salesRow ? salesRow.total : 0;
    const expectedRevenue = totalSold * price;

    const closing = await get(
      `SELECT * FROM daily_closings WHERE stall_id = 1 AND date = ?`,
      [today]
    );

    const cash = closing ? closing.cash_received : 0;
    const upi = closing ? closing.upi_received : 0;
    const totalReceived = closing ? closing.total_received : 0;
    const discrepancy = closing ? closing.discrepancy : null;
    const isClosed = !!closing;
    const isMatched = isClosed && discrepancy === 0;

    return res.json({
      today,
      expectedRevenue,
      cash,
      upi,
      totalReceived,
      discrepancy,
      isClosed,
      isMatched,
      statusLabel: !isClosed ? 'UNCLOSED' : isMatched ? 'MATCHED' : 'DISCREPANCY'
    });
  } catch (err) {
    console.error('Admin money error:', err);
    return res.status(500).json({ error: 'Failed to fetch money reconciliation' });
  }
});

// GET /api/admin/reports
router.get('/reports', async (req, res) => {
  try {
    const today = getTodayDateString();

    const product = await get('SELECT * FROM products WHERE id = 1');
    const sellingPrice = product ? product.selling_price : 40.0;
    const directCost = product ? product.direct_cost : 20.0;

    const salesRow = await get(
      `SELECT COALESCE(SUM(quantity), 0) as total FROM sales WHERE DATE(created_at, 'localtime') = DATE('now', 'localtime')`
    );
    const totalSold = salesRow ? salesRow.total : 0;

    const totalRevenue = totalSold * sellingPrice;
    const totalProductCost = totalSold * directCost;
    const staffCost = 0.0;
    const estimatedOperatingProfit = totalRevenue - totalProductCost - staffCost;

    return res.json({
      date: today,
      totalGlassesSold: totalSold,
      sellingPrice,
      directCost,
      totalRevenue,
      totalProductCost,
      staffCost,
      estimatedOperatingProfit
    });
  } catch (err) {
    console.error('Admin report error:', err);
    return res.status(500).json({ error: 'Failed to generate report' });
  }
});

module.exports = router;
