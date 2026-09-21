const express = require('express');
const router = express.Router();
const { get, all, run, getISTBusinessDate, getUTCTimestamp } = require('../db');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { broadcastEvent } = require('../websocket');

router.use(authenticateToken);
router.use(requireRole('STALL_USER'));

// GET /api/stall/dashboard
router.get('/dashboard', async (req, res) => {
  try {
    const stallId = req.user.stall_id || 1;
    const today = getISTBusinessDate();

    const stall = await get('SELECT * FROM stalls WHERE id = ?', [stallId]);
    const product = await get('SELECT * FROM products WHERE id = 1');

    // Received stock today (dispatches received on today's IST business date)
    const receivedRow = await get(
      `SELECT COALESCE(SUM(COALESCE(received_quantity, quantity)), 0) as total 
       FROM stock_dispatches 
       WHERE stall_id = ? AND status = 'RECEIVED' AND received_business_date = ?`,
      [stallId, today]
    );
    const stockReceived = receivedRow ? receivedRow.total : 0;

    // Sales count today (net sum of quantity, taking reversals into account)
    const salesRow = await get(
      `SELECT COALESCE(SUM(quantity), 0) as total 
       FROM sales 
       WHERE stall_id = ? AND business_date = ?`,
      [stallId, today]
    );
    const soldToday = salesRow ? salesRow.total : 0;

    // Wastage count today
    const wastageRow = await get(
      `SELECT COALESCE(SUM(quantity), 0) as total 
       FROM wastages 
       WHERE stall_id = ? AND business_date = ?`,
      [stallId, today]
    );
    const wastageToday = wastageRow ? wastageRow.total : 0;

    // Expected revenue = sum of quantity * selling_price stored on each sale
    const revenueRow = await get(
      `SELECT COALESCE(SUM(quantity * selling_price), 0) as total 
       FROM sales 
       WHERE stall_id = ? AND business_date = ?`,
      [stallId, today]
    );
    const expectedRevenue = revenueRow ? revenueRow.total : 0;

    // Pending stock dispatches of ANY age stay visible until confirmed
    const pendingDispatches = await all(
      `SELECT d.*, u.name as dispatched_by_name 
       FROM stock_dispatches d 
       LEFT JOIN users u ON d.dispatched_by = u.id 
       WHERE d.stall_id = ? AND d.status = 'DISPATCHED' 
       ORDER BY d.id ASC`,
      [stallId]
    );

    // Active daily closing record for today
    const closing = await get(
      `SELECT * FROM daily_closings WHERE stall_id = ? AND business_date = ? AND status = 'ACTIVE'`,
      [stallId, today]
    );

    return res.json({
      today,
      stall,
      product,
      stockReceived,
      soldToday,
      wastageToday,
      pendingDispatches,
      closingSubmitted: !!closing
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
    const today = getISTBusinessDate();
    const { idempotency_key } = req.body;

    if (!idempotency_key) {
      return res.status(400).json({ error: 'idempotency_key is required for sales' });
    }

    // Check if day is closed
    const activeClosing = await get(
      `SELECT id FROM daily_closings WHERE stall_id = ? AND business_date = ? AND status = 'ACTIVE'`,
      [stallId, today]
    );

    if (activeClosing) {
      return res.status(409).json({
        error: 'Day is closed. Cannot perform sales.',
        code: 'DAY_CLOSED'
      });
    }

    // Idempotency check: if key already exists, return original sale response (200 OK)
    const existingSale = await get('SELECT * FROM sales WHERE idempotency_key = ?', [idempotency_key]);
    if (existingSale) {
      const salesRow = await get(
        `SELECT COALESCE(SUM(quantity), 0) as total FROM sales WHERE stall_id = ? AND business_date = ?`,
        [stallId, today]
      );
      return res.json({
        success: true,
        idempotent: true,
        sale: existingSale,
        soldToday: salesRow ? salesRow.total : 0
      });
    }

    const product = await get('SELECT * FROM products WHERE id = 1');
    const sellingPrice = product ? product.selling_price : 40.0;
    const utcTimestamp = getUTCTimestamp();

    // Insert sale record
    await run(
      `INSERT INTO sales (stall_id, product_id, quantity, selling_price, created_at, created_by, business_date, idempotency_key)
       VALUES (?, 1, 1, ?, ?, ?, ?, ?)`,
      [stallId, sellingPrice, utcTimestamp, req.user.id, today, idempotency_key]
    );

    // Calculate updated stock and revenue
    const salesRow = await get(
      `SELECT COALESCE(SUM(quantity), 0) as total FROM sales WHERE stall_id = ? AND business_date = ?`,
      [stallId, today]
    );
    const soldToday = salesRow ? salesRow.total : 0;

    const receivedRow = await get(
      `SELECT COALESCE(SUM(COALESCE(received_quantity, quantity)), 0) as total FROM stock_dispatches WHERE stall_id = ? AND status = 'RECEIVED' AND received_business_date = ?`,
      [stallId, today]
    );
    const stockReceived = receivedRow ? receivedRow.total : 0;

    const wastageRow = await get(
      `SELECT COALESCE(SUM(quantity), 0) as total FROM wastages WHERE stall_id = ? AND business_date = ?`,
      [stallId, today]
    );
    const wastageToday = wastageRow ? wastageRow.total : 0;

    const expectedRemaining = stockReceived - soldToday - wastageToday;
    const warning = expectedRemaining <= 0 ? 'No stock recorded. Confirm receipt or tell admin.' : null;

    // Broadcast Real-Time Event
    broadcastEvent('STALL_ACTION', {
      eventType: 'SALE',
      stall_id: stallId,
      stall_name: `Stall ${stallId}`,
      product_name: product ? product.name : 'Butter Fruit Payasam',
      quantity: 1,
      created_at: utcTimestamp,
      warning,
      text: `Stall ${stallId} sold 1 ${product ? product.name : 'Butter Fruit Payasam'}`
    });

    return res.json({
      success: true,
      soldToday,
      expectedRemaining,
      expectedRevenue: soldToday * sellingPrice,
      warning
    });
  } catch (err) {
    console.error('Sell error:', err);
    return res.status(500).json({ error: err.message || 'Failed to record sale' });
  }
});

// POST /api/stall/undo-last
router.post('/undo-last', async (req, res) => {
  try {
    const stallId = req.user.stall_id || 1;
    const today = getISTBusinessDate();

    // Check if day is closed
    const activeClosing = await get(
      `SELECT id FROM daily_closings WHERE stall_id = ? AND business_date = ? AND status = 'ACTIVE'`,
      [stallId, today]
    );

    if (activeClosing) {
      return res.status(409).json({
        error: 'Day is closed. Cannot undo sales.',
        code: 'DAY_CLOSED'
      });
    }

    // Find most recent un-reversed sale of today
    const lastSale = await get(
      `SELECT * FROM sales 
       WHERE stall_id = ? AND business_date = ? AND quantity = 1 
             AND id NOT IN (SELECT reversal_of FROM sales WHERE reversal_of IS NOT NULL) 
       ORDER BY id DESC LIMIT 1`,
      [stallId, today]
    );

    if (!lastSale) {
      return res.status(400).json({ error: 'No eligible sale to undo for today.' });
    }

    // Verify age <= 120 seconds
    const saleTime = new Date(lastSale.created_at).getTime();
    const nowTime = Date.now();
    const ageSeconds = (nowTime - saleTime) / 1000;

    if (ageSeconds > 120) {
      return res.status(400).json({ error: 'Undo window expired (must be within 120 seconds of sale).' });
    }

    const utcTimestamp = getUTCTimestamp();
    const undoIdempotencyKey = `undo_${lastSale.id}_${nowTime}`;

    // Insert reversal row
    await run(
      `INSERT INTO sales (stall_id, product_id, quantity, selling_price, created_at, created_by, business_date, idempotency_key, reversal_of, reversal_reason)
       VALUES (?, ?, -1, ?, ?, ?, ?, ?, ?, ?)`,
      [stallId, lastSale.product_id, lastSale.selling_price, utcTimestamp, req.user.id, today, undoIdempotencyKey, lastSale.id, 'Stall undo']
    );

    // Broadcast Real-Time Event
    broadcastEvent('STALL_ACTION', {
      eventType: 'UNDO_SALE',
      stall_id: stallId,
      stall_name: `Stall ${stallId}`,
      reversed_sale_id: lastSale.id,
      created_at: utcTimestamp,
      text: `Stall ${stallId} undone sale #${lastSale.id}`
    });

    return res.json({
      success: true,
      message: `Sale #${lastSale.id} reversed successfully`
    });
  } catch (err) {
    console.error('Undo sale error:', err);
    return res.status(500).json({ error: err.message || 'Failed to undo sale' });
  }
});

// POST /api/stall/confirm-receipt
router.post('/confirm-receipt', async (req, res) => {
  try {
    const stallId = req.user.stall_id || 1;
    const today = getISTBusinessDate();
    const { dispatch_id, received_quantity } = req.body;

    const dispatch = await get('SELECT * FROM stock_dispatches WHERE id = ? AND stall_id = ? AND status = \'DISPATCHED\'', [dispatch_id, stallId]);
    if (!dispatch) {
      return res.status(404).json({ error: 'Pending dispatch record not found' });
    }

    const finalReceivedQty = received_quantity !== undefined && received_quantity !== null
      ? Number(received_quantity)
      : dispatch.quantity;

    if (isNaN(finalReceivedQty) || finalReceivedQty < 0 || finalReceivedQty > 500) {
      return res.status(400).json({ error: 'Received quantity must be an integer between 0 and 500' });
    }

    const utcTimestamp = getUTCTimestamp();

    await run(
      `UPDATE stock_dispatches 
       SET status = 'RECEIVED', 
           received_at = ?, 
           received_by = ?, 
           received_quantity = ?, 
           received_business_date = ? 
       WHERE id = ? AND stall_id = ? AND status = 'DISPATCHED'`,
      [utcTimestamp, req.user.id, finalReceivedQty, today, dispatch_id, stallId]
    );

    const isVariance = finalReceivedQty !== dispatch.quantity;
    const varianceType = finalReceivedQty < dispatch.quantity ? `SHORT ${dispatch.quantity - finalReceivedQty}` : `MORE ${finalReceivedQty - dispatch.quantity}`;

    // Broadcast Real-Time Event
    broadcastEvent('STALL_ACTION', {
      eventType: 'RECEIPT',
      stall_id: stallId,
      stall_name: `Stall ${stallId}`,
      quantity: finalReceivedQty,
      dispatched_quantity: dispatch.quantity,
      is_variance: isVariance,
      created_at: utcTimestamp,
      text: isVariance
        ? `Stall ${stallId} confirmed receipt of ${finalReceivedQty} glasses (Dispatched: ${dispatch.quantity} — ${varianceType})`
        : `Stall ${stallId} confirmed receipt of ${finalReceivedQty} glasses`
    });

    return res.json({
      success: true,
      message: 'Stock receipt confirmed',
      received_quantity: finalReceivedQty
    });
  } catch (err) {
    console.error('Confirm receipt error:', err);
    return res.status(500).json({ error: 'Failed to confirm receipt' });
  }
});

// POST /api/stall/wastage
router.post('/wastage', async (req, res) => {
  try {
    const stallId = req.user.stall_id || 1;
    const today = getISTBusinessDate();
    const { quantity, reason } = req.body;

    const qty = Number(quantity);
    if (isNaN(qty) || qty < 1 || qty > 200) {
      return res.status(400).json({ error: 'Wastage quantity must be an integer between 1 and 200' });
    }

    const validReasons = ['Spoiled', 'Spilled', 'Damaged', 'Free sample', 'Other'];
    if (!validReasons.includes(reason)) {
      return res.status(400).json({ error: 'Invalid wastage reason. Allowed: ' + validReasons.join(', ') });
    }

    // Check if day is closed
    const activeClosing = await get(
      `SELECT id FROM daily_closings WHERE stall_id = ? AND business_date = ? AND status = 'ACTIVE'`,
      [stallId, today]
    );

    if (activeClosing) {
      return res.status(409).json({
        error: 'Day is closed. Cannot record wastage.',
        code: 'DAY_CLOSED'
      });
    }

    const utcTimestamp = getUTCTimestamp();

    await run(
      `INSERT INTO wastages (stall_id, product_id, quantity, reason, created_at, created_by, business_date)
       VALUES (?, 1, ?, ?, ?, ?, ?)`,
      [stallId, qty, reason, utcTimestamp, req.user.id, today]
    );

    // Check if total wastage today > 10% of total stock received today
    const receivedRow = await get(
      `SELECT COALESCE(SUM(COALESCE(received_quantity, quantity)), 0) as total FROM stock_dispatches WHERE stall_id = ? AND status = 'RECEIVED' AND received_business_date = ?`,
      [stallId, today]
    );
    const stockReceived = receivedRow ? receivedRow.total : 0;

    const wastageRow = await get(
      `SELECT COALESCE(SUM(quantity), 0) as total FROM wastages WHERE stall_id = ? AND business_date = ?`,
      [stallId, today]
    );
    const totalWastageToday = wastageRow ? wastageRow.total : 0;

    const isLargeWastage = stockReceived > 0 && totalWastageToday > 0.10 * stockReceived;

    // Broadcast Real-Time Event
    broadcastEvent('STALL_ACTION', {
      eventType: 'WASTAGE',
      stall_id: stallId,
      stall_name: `Stall ${stallId}`,
      quantity: qty,
      reason,
      is_large_wastage: isLargeWastage,
      created_at: utcTimestamp,
      text: isLargeWastage
        ? `Stall ${stallId} recorded ${qty} wastage (${reason}) [FLAGGED: >10% of stock]`
        : `Stall ${stallId} recorded ${qty} wastage (${reason})`
    });

    return res.json({ success: true, message: 'Wastage recorded successfully', is_large_wastage: isLargeWastage });
  } catch (err) {
    console.error('Wastage error:', err);
    return res.status(500).json({ error: 'Failed to record wastage' });
  }
});

// POST /api/stall/close-day
router.post('/close-day', async (req, res) => {
  try {
    const stallId = req.user.stall_id || 1;
    const today = getISTBusinessDate();

    const { actual_remaining, cash_received, upi_received } = req.body;

    const actualRem = Number(actual_remaining);
    const cash = Number(cash_received);
    const upi = Number(upi_received);

    if (isNaN(actualRem) || isNaN(cash) || isNaN(upi) || cash < 0 || upi < 0) {
      return res.status(400).json({ error: 'Valid non-negative numbers are required for actual remaining, cash, and UPI.' });
    }

    // Check if active closing already exists for today
    const existingClosing = await get(
      `SELECT id FROM daily_closings WHERE stall_id = ? AND business_date = ? AND status = 'ACTIVE'`,
      [stallId, today]
    );

    if (existingClosing) {
      return res.status(409).json({ error: 'Daily closing has already been submitted for today.' });
    }

    // Calculate SNAPSHOT values
    const receivedRow = await get(
      `SELECT COALESCE(SUM(COALESCE(received_quantity, quantity)), 0) as total FROM stock_dispatches WHERE stall_id = ? AND status = 'RECEIVED' AND received_business_date = ?`,
      [stallId, today]
    );
    const receivedTotal = receivedRow ? receivedRow.total : 0;

    const salesRow = await get(
      `SELECT COALESCE(SUM(quantity), 0) as total FROM sales WHERE stall_id = ? AND business_date = ?`,
      [stallId, today]
    );
    const soldTotal = salesRow ? salesRow.total : 0;

    const wastageRow = await get(
      `SELECT COALESCE(SUM(quantity), 0) as total FROM wastages WHERE stall_id = ? AND business_date = ?`,
      [stallId, today]
    );
    const wastageTotal = wastageRow ? wastageRow.total : 0;

    const revenueRow = await get(
      `SELECT COALESCE(SUM(quantity * selling_price), 0) as total FROM sales WHERE stall_id = ? AND business_date = ?`,
      [stallId, today]
    );
    const expectedRevenue = revenueRow ? revenueRow.total : 0;

    const expectedRemaining = receivedTotal - soldTotal - wastageTotal;
    const stockVariance = actualRem - expectedRemaining;
    const stockVarianceValue = stockVariance * 40.0;
    const totalReceived = cash + upi;
    const moneyDifference = totalReceived - expectedRevenue;

    const stockStatus = stockVariance === 0 ? 'MATCHED' : stockVariance < 0 ? 'SHORT' : 'EXTRA';
    const moneyStatus = moneyDifference === 0 ? 'MATCHED' : moneyDifference < 0 ? 'SHORT' : 'EXTRA';

    const utcTimestamp = getUTCTimestamp();

    await run(
      `INSERT INTO daily_closings (
        stall_id, business_date, actual_remaining, cash_received, upi_received,
        received_total, sold_total, wastage_total, expected_remaining, expected_revenue,
        stock_variance, stock_variance_value, money_difference, stock_status, money_status,
        status, submitted_at, submitted_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`,
      [
        stallId, today, actualRem, cash, upi,
        receivedTotal, soldTotal, wastageTotal, expectedRemaining, expectedRevenue,
        stockVariance, stockVarianceValue, moneyDifference, stockStatus, moneyStatus,
        utcTimestamp, req.user.id
      ]
    );

    // Broadcast Real-Time Event
    broadcastEvent('STALL_ACTION', {
      eventType: 'CLOSE_DAY',
      stall_id: stallId,
      stall_name: `Stall ${stallId}`,
      stock_status: stockStatus,
      money_status: moneyStatus,
      stock_variance: stockVariance,
      money_difference: moneyDifference,
      created_at: utcTimestamp,
      text: `Stall ${stallId} submitted daily closing (Stock: ${stockStatus}, Money: ${moneyStatus})`
    });

    return res.json({
      success: true,
      message: 'Day closed'
    });
  } catch (err) {
    console.error('Close day error:', err);
    return res.status(500).json({ error: 'Failed to submit daily closing' });
  }
});

module.exports = router;
