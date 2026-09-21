const express = require('express');
const router = express.Router();
const { get, all, run } = require('../db');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { broadcastEvent } = require('../websocket');

const getTodayDateString = () => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Protect all stall routes
router.use(authenticateToken);
router.use(requireRole('STALL_USER'));

// GET /api/stall/dashboard
router.get('/dashboard', async (req, res) => {
  try {
    const stallId = req.user.stall_id || 1;
    const today = getTodayDateString();

    const stall = await get('SELECT * FROM stalls WHERE id = ?', [stallId]);
    const product = await get('SELECT * FROM products WHERE id = 1');

    // Received stock today
    const receivedRow = await get(
      `SELECT COALESCE(SUM(quantity), 0) as total 
       FROM stock_dispatches 
       WHERE stall_id = ? AND status = 'RECEIVED' AND DATE(created_at, 'localtime') = DATE('now', 'localtime')`,
      [stallId]
    );
    const stockReceived = receivedRow ? receivedRow.total : 0;

    // Sales count today
    const salesRow = await get(
      `SELECT COALESCE(SUM(quantity), 0) as total 
       FROM sales 
       WHERE stall_id = ? AND DATE(created_at, 'localtime') = DATE('now', 'localtime')`,
      [stallId]
    );
    const soldToday = salesRow ? salesRow.total : 0;

    // Wastage count today
    const wastageRow = await get(
      `SELECT COALESCE(SUM(quantity), 0) as total 
       FROM wastages 
       WHERE stall_id = ? AND DATE(created_at, 'localtime') = DATE('now', 'localtime')`,
      [stallId]
    );
    const wastageToday = wastageRow ? wastageRow.total : 0;

    // Pending stock dispatches awaiting receipt confirmation
    const pendingDispatches = await all(
      `SELECT d.*, u.name as dispatched_by_name 
       FROM stock_dispatches d 
       LEFT JOIN users u ON d.dispatched_by = u.id 
       WHERE d.stall_id = ? AND d.status = 'DISPATCHED'`,
      [stallId]
    );

    // Daily closing record if submitted today
    const closing = await get(
      `SELECT * FROM daily_closings WHERE stall_id = ? AND date = ?`,
      [stallId, today]
    );

    const expectedRemaining = stockReceived - soldToday - wastageToday;
    const expectedRevenue = soldToday * (product ? product.selling_price : 40);

    return res.json({
      today,
      stall,
      product,
      stockReceived,
      soldToday,
      wastageToday,
      expectedRemaining,
      expectedRevenue,
      pendingDispatches,
      closingSubmitted: !!closing,
      closingData: closing || null
    });
  } catch (err) {
    console.error('Stall dashboard error:', err);
    return res.status(500).json({ error: 'Failed to fetch stall dashboard data' });
  }
});

// POST /api/stall/sell
router.post('/sell', async (req, res) => {
  try {
    const stallId = req.user.stall_id || 1;
    const product = await get('SELECT * FROM products WHERE id = 1');
    const sellingPrice = product ? product.selling_price : 40.0;

    // Insert sale record - APPEND ONLY
    const result = await run(
      `INSERT INTO sales (stall_id, product_id, quantity, selling_price, created_by)
       VALUES (?, 1, 1, ?, ?)`,
      [stallId, sellingPrice, req.user.id]
    );

    // Return updated counts
    const salesRow = await get(
      `SELECT COALESCE(SUM(quantity), 0) as total 
       FROM sales 
       WHERE stall_id = ? AND DATE(created_at, 'localtime') = DATE('now', 'localtime')`,
      [stallId]
    );
    const soldToday = salesRow ? salesRow.total : 0;
    const nowIso = new Date().toISOString();

    // Broadcast Real-Time Event to Admin Dashboard!
    broadcastEvent('STALL_ACTION', {
      eventType: 'SALE',
      stall_id: stallId,
      stall_name: `Stall ${stallId}`,
      product_name: product ? product.name : 'Butter Fruit Payasam',
      quantity: 1,
      created_at: nowIso,
      text: `Stall ${stallId} sold 1 ${product ? product.name : 'Butter Fruit Payasam'}`
    });

    return res.json({
      success: true,
      soldToday,
      expectedRevenue: soldToday * sellingPrice
    });
  } catch (err) {
    console.error('Sell error:', err);
    return res.status(500).json({ error: 'Failed to record sale' });
  }
});

// POST /api/stall/confirm-receipt
router.post('/confirm-receipt', async (req, res) => {
  try {
    const stallId = req.user.stall_id || 1;
    const { dispatch_id } = req.body;

    let qty = 50;
    if (dispatch_id) {
      const d = await get('SELECT quantity FROM stock_dispatches WHERE id = ?', [dispatch_id]);
      if (d) qty = d.quantity;

      await run(
        `UPDATE stock_dispatches 
         SET status = 'RECEIVED', received_at = CURRENT_TIMESTAMP, received_by = ? 
         WHERE id = ? AND stall_id = ? AND status = 'DISPATCHED'`,
        [req.user.id, dispatch_id, stallId]
      );
    } else {
      await run(
        `UPDATE stock_dispatches 
         SET status = 'RECEIVED', received_at = CURRENT_TIMESTAMP, received_by = ? 
         WHERE stall_id = ? AND status = 'DISPATCHED'`,
        [req.user.id, stallId]
      );
    }

    const nowIso = new Date().toISOString();

    // Broadcast Real-Time Event!
    broadcastEvent('STALL_ACTION', {
      eventType: 'RECEIPT',
      stall_id: stallId,
      stall_name: `Stall ${stallId}`,
      quantity: qty,
      created_at: nowIso,
      text: `Stall ${stallId} confirmed receipt of ${qty} glasses`
    });

    return res.json({ success: true, message: 'Stock receipt confirmed' });
  } catch (err) {
    console.error('Confirm receipt error:', err);
    return res.status(500).json({ error: 'Failed to confirm receipt' });
  }
});

// POST /api/stall/wastage
router.post('/wastage', async (req, res) => {
  try {
    const stallId = req.user.stall_id || 1;
    const { quantity, reason } = req.body;

    if (!quantity || quantity <= 0) {
      return res.status(400).json({ error: 'Valid wastage quantity is required' });
    }

    const validReasons = ['Spoiled', 'Spilled', 'Damaged', 'Other'];
    const wastageReason = validReasons.includes(reason) ? reason : 'Other';

    // Insert wastage record - APPEND ONLY
    await run(
      `INSERT INTO wastages (stall_id, product_id, quantity, reason, created_by)
       VALUES (?, 1, ?, ?, ?)`,
      [stallId, Number(quantity), wastageReason, req.user.id]
    );

    const nowIso = new Date().toISOString();

    // Broadcast Real-Time Event!
    broadcastEvent('STALL_ACTION', {
      eventType: 'WASTAGE',
      stall_id: stallId,
      stall_name: `Stall ${stallId}`,
      quantity: Number(quantity),
      reason: wastageReason,
      created_at: nowIso,
      text: `Stall ${stallId} recorded ${quantity} wastage (${wastageReason})`
    });

    return res.json({ success: true, message: 'Wastage recorded successfully' });
  } catch (err) {
    console.error('Wastage error:', err);
    return res.status(500).json({ error: 'Failed to record wastage' });
  }
});

// POST /api/stall/close-day
router.post('/close-day', async (req, res) => {
  try {
    const stallId = req.user.stall_id || 1;
    const today = getTodayDateString();

    const { actual_remaining, cash_received, upi_received } = req.body;

    if (actual_remaining === undefined || cash_received === undefined || upi_received === undefined) {
      return res.status(400).json({ error: 'Actual remaining stock, cash, and UPI values are required' });
    }

    const product = await get('SELECT * FROM products WHERE id = 1');
    const sellingPrice = product ? product.selling_price : 40.0;

    // Get sold count
    const salesRow = await get(
      `SELECT COALESCE(SUM(quantity), 0) as total 
       FROM sales 
       WHERE stall_id = ? AND DATE(created_at, 'localtime') = DATE('now', 'localtime')`,
      [stallId]
    );
    const soldToday = salesRow ? salesRow.total : 0;

    const expectedRevenue = soldToday * sellingPrice;
    const totalReceived = Number(cash_received) + Number(upi_received);
    const discrepancy = totalReceived - expectedRevenue;

    // Delete existing closing for today if re-submitting
    await run(`DELETE FROM daily_closings WHERE stall_id = ? AND date = ?`, [stallId, today]);

    await run(
      `INSERT INTO daily_closings (
        stall_id, date, actual_remaining, cash_received, upi_received, expected_revenue, total_received, discrepancy, submitted_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        stallId,
        today,
        Number(actual_remaining),
        Number(cash_received),
        Number(upi_received),
        expectedRevenue,
        totalReceived,
        discrepancy,
        req.user.id
      ]
    );

    const nowIso = new Date().toISOString();

    // Broadcast Real-Time Event!
    broadcastEvent('STALL_ACTION', {
      eventType: 'CLOSE_DAY',
      stall_id: stallId,
      stall_name: `Stall ${stallId}`,
      discrepancy,
      created_at: nowIso,
      text: `Stall ${stallId} submitted daily closing (Discrepancy: ₹${discrepancy})`
    });

    return res.json({
      success: true,
      message: 'Day closed successfully',
      closing: {
        date: today,
        expectedRevenue,
        totalReceived,
        discrepancy
      }
    });
  } catch (err) {
    console.error('Close day error:', err);
    return res.status(500).json({ error: 'Failed to submit daily closing' });
  }
});

module.exports = router;
