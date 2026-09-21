const express = require('express');
const router = express.Router();
const { get, all, run, getISTBusinessDate, getUTCTimestamp } = require('../db');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { broadcastEvent } = require('../websocket');

router.use(authenticateToken);
router.use(requireRole('STALL_USER'));

// Middleware: Require active session for today (Day Started enforcement)
const requireActiveSession = async (req, res, next) => {
  try {
    const stallId = req.user.stall_id || 1;
    const today = getISTBusinessDate();
    const activeSession = await get(
      `SELECT * FROM stall_sessions WHERE stall_id = ? AND business_date = ? AND status = 'ACTIVE'`,
      [stallId, today]
    );
    if (!activeSession) {
      return res.status(409).json({ error: 'Day not started today. Please press Start Day.', code: 'DAY_NOT_STARTED' });
    }
    next();
  } catch (err) {
    next(err);
  }
};

// Helper function to fetch current stock breakdown for a stall today
const getStockCounts = async (stallId, today) => {
  const receivedRow = await get(
    `SELECT COALESCE(SUM(COALESCE(received_quantity, quantity)), 0) as total FROM stock_dispatches WHERE stall_id = ? AND status = 'RECEIVED' AND received_business_date = ?`,
    [stallId, today]
  );
  const stockReceived = receivedRow ? receivedRow.total : 0;

  const salesRow = await get(
    `SELECT COALESCE(SUM(quantity), 0) as total FROM sales WHERE stall_id = ? AND business_date = ?`,
    [stallId, today]
  );
  const soldToday = salesRow ? salesRow.total : 0;

  const wastageRow = await get(
    `SELECT COALESCE(SUM(quantity), 0) as total FROM wastages WHERE stall_id = ? AND business_date = ?`,
    [stallId, today]
  );
  const wastageToday = wastageRow ? wastageRow.total : 0;

  const remaining = stockReceived - soldToday - wastageToday;
  return { stockReceived, soldToday, wastageToday, remaining };
};

// GET /api/stall/dashboard
router.get('/dashboard', async (req, res) => {
  try {
    const stallId = req.user.stall_id || 1;
    const today = getISTBusinessDate();

    const stall = await get('SELECT * FROM stalls WHERE id = ?', [stallId]);
    const product = await get('SELECT * FROM products WHERE id = 1');

    // Session check for dayStarted (true if any session was started today)
    const latestSession = await get(
      `SELECT * FROM stall_sessions WHERE stall_id = ? AND business_date = ? ORDER BY id DESC LIMIT 1`,
      [stallId, today]
    );
    const dayStarted = !!latestSession;

    const { stockReceived, soldToday, wastageToday, remaining: computedRemaining } = await getStockCounts(stallId, today);

    // Pending stock dispatches
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
      dayStarted,
      stockReceived,
      soldToday,
      wastageToday,
      computedRemaining,
      pendingDispatches,
      closingSubmitted: !!closing
    });
  } catch (err) {
    console.error('Stall dashboard error:', err);
    return res.status(500).json({ error: 'Failed to fetch stall dashboard data' });
  }
});

// POST /api/stall/start-day
router.post('/start-day', async (req, res) => {
  try {
    const stallId = req.user.stall_id || 1;
    const today = getISTBusinessDate();
    const utcTimestamp = getUTCTimestamp();

    const existingSession = await get(
      `SELECT id FROM stall_sessions WHERE stall_id = ? AND business_date = ? AND status = 'ACTIVE'`,
      [stallId, today]
    );

    if (existingSession) {
      return res.json({ success: true, message: 'Day already started', session_id: existingSession.id });
    }

    await run(
      `INSERT INTO stall_sessions (stall_id, business_date, started_at, started_by, status)
       VALUES (?, ?, ?, ?, 'ACTIVE')`,
      [stallId, today, utcTimestamp, req.user.id]
    );

    // Broadcast WS event for Day Started
    broadcastEvent('STALL_ACTION', {
      eventType: 'DAY_STARTED',
      stall_id: stallId,
      stall_name: `Stall ${stallId}`,
      created_at: utcTimestamp,
      text: `Stall ${stallId} worker started day`
    });

    return res.json({ success: true, message: 'Day started' });
  } catch (err) {
    console.error('Start day error:', err);
    return res.status(500).json({ error: 'Failed to start day' });
  }
});

// POST /api/stall/sell
router.post('/sell', requireActiveSession, async (req, res) => {
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

    // Idempotency check
    const existingSale = await get('SELECT * FROM sales WHERE idempotency_key = ?', [idempotency_key]);
    if (existingSale) {
      const { soldToday } = await getStockCounts(stallId, today);
      return res.json({
        success: true,
        idempotent: true,
        sale: existingSale,
        soldToday
      });
    }

    // T1.6-3 Stock Cap check
    const { remaining } = await getStockCounts(stallId, today);
    if (remaining < 1) {
      return res.status(409).json({
        error: 'Item finished',
        code: 'STOCK_FINISHED'
      });
    }

    const product = await get('SELECT * FROM products WHERE id = 1');
    const sellingPrice = product ? product.selling_price : 40.0;
    const utcTimestamp = getUTCTimestamp();

    await run(
      `INSERT INTO sales (stall_id, product_id, quantity, selling_price, created_at, created_by, business_date, idempotency_key)
       VALUES (?, 1, 1, ?, ?, ?, ?, ?)`,
      [stallId, sellingPrice, utcTimestamp, req.user.id, today, idempotency_key]
    );

    const { soldToday: newSoldToday } = await getStockCounts(stallId, today);

    broadcastEvent('STALL_ACTION', {
      eventType: 'SALE',
      stall_id: stallId,
      stall_name: `Stall ${stallId}`,
      product_name: product ? product.name : 'Butter Fruit Payasam',
      quantity: 1,
      created_at: utcTimestamp,
      text: `Stall ${stallId} sold 1 ${product ? product.name : 'Butter Fruit Payasam'}`
    });

    return res.json({
      success: true,
      soldToday: newSoldToday
    });
  } catch (err) {
    console.error('Sell error:', err);
    return res.status(500).json({ error: err.message || 'Failed to record sale' });
  }
});

// POST /api/stall/sell-parcel (T1.6-4 Parcel Sales: +3 glasses, ₹120)
router.post('/sell-parcel', requireActiveSession, async (req, res) => {
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

    // Idempotency check
    const existingSale = await get('SELECT * FROM sales WHERE idempotency_key = ?', [idempotency_key]);
    if (existingSale) {
      const { soldToday } = await getStockCounts(stallId, today);
      return res.json({
        success: true,
        idempotent: true,
        sale: existingSale,
        soldToday
      });
    }

    // Stock Cap check: Parcel requires 3 free units
    const { remaining } = await getStockCounts(stallId, today);
    if (remaining < 3) {
      return res.status(409).json({
        error: 'Item finished',
        code: 'STOCK_FINISHED'
      });
    }

    const utcTimestamp = getUTCTimestamp();
    const product = await get('SELECT * FROM products WHERE id = 1');
    const unitSellingPrice = product ? product.selling_price : 40.0;

    await run(
      `INSERT INTO sales (stall_id, product_id, quantity, selling_price, created_at, created_by, business_date, idempotency_key)
       VALUES (?, 1, 3, ?, ?, ?, ?, ?)`,
      [stallId, unitSellingPrice, utcTimestamp, req.user.id, today, idempotency_key]
    );

    const { soldToday: newSoldToday } = await getStockCounts(stallId, today);

    broadcastEvent('STALL_ACTION', {
      eventType: 'SALE',
      stall_id: stallId,
      stall_name: `Stall ${stallId}`,
      product_name: 'Parcel (3 Glasses)',
      quantity: 3,
      created_at: utcTimestamp,
      text: `Stall ${stallId} sold 1 Parcel (3 glasses)`
    });

    return res.json({
      success: true,
      soldToday: newSoldToday
    });
  } catch (err) {
    console.error('Sell parcel error:', err);
    return res.status(500).json({ error: err.message || 'Failed to record parcel sale' });
  }
});

// POST /api/stall/undo-last (15-second server cutoff, handles glass & parcel)
router.post('/undo-last', requireActiveSession, async (req, res) => {
  try {
    const stallId = req.user.stall_id || 1;
    const today = getISTBusinessDate();

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

    const lastSale = await get(
      `SELECT * FROM sales 
       WHERE stall_id = ? AND business_date = ? AND quantity > 0 
             AND id NOT IN (SELECT reversal_of FROM sales WHERE reversal_of IS NOT NULL) 
       ORDER BY id DESC LIMIT 1`,
      [stallId, today]
    );

    if (!lastSale) {
      return res.status(400).json({ error: 'No eligible sale to undo for today.' });
    }

    // Verify age <= 15 seconds
    const saleTime = new Date(lastSale.created_at).getTime();
    const nowTime = Date.now();
    const ageSeconds = (nowTime - saleTime) / 1000;

    if (ageSeconds > 15) {
      return res.status(400).json({ error: 'Undo window expired (must be within 15 seconds of sale).' });
    }

    const utcTimestamp = getUTCTimestamp();
    const undoIdempotencyKey = `undo_${lastSale.id}_${nowTime}`;
    const undoQuantity = -lastSale.quantity;
    const undoPrice = lastSale.selling_price;

    await run(
      `INSERT INTO sales (stall_id, product_id, quantity, selling_price, created_at, created_by, business_date, idempotency_key, reversal_of, reversal_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [stallId, lastSale.product_id, undoQuantity, undoPrice, utcTimestamp, req.user.id, today, undoIdempotencyKey, lastSale.id, 'Stall undo']
    );

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
router.post('/confirm-receipt', requireActiveSession, async (req, res) => {
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
router.post('/wastage', requireActiveSession, async (req, res) => {
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

    // Stock Cap Check: Wastage cannot push total sold + wastage past received
    const { remaining } = await getStockCounts(stallId, today);
    if (remaining < qty) {
      return res.status(409).json({
        error: 'Item finished',
        code: 'STOCK_FINISHED'
      });
    }

    const utcTimestamp = getUTCTimestamp();

    await run(
      `INSERT INTO wastages (stall_id, product_id, quantity, reason, created_at, created_by, business_date)
       VALUES (?, 1, ?, ?, ?, ?, ?)`,
      [stallId, qty, reason, utcTimestamp, req.user.id, today]
    );

    const { stockReceived, wastageToday: totalWastageToday } = await getStockCounts(stallId, today);

    const isLargeWastage = stockReceived > 0 && totalWastageToday > 0.10 * stockReceived;

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

// POST /api/stall/close-day (Semi-Blind with Generic Mismatch Warning)
router.post('/close-day', requireActiveSession, async (req, res) => {
  try {
    const stallId = req.user.stall_id || 1;
    const today = getISTBusinessDate();
    const utcTimestamp = getUTCTimestamp();

    const { cash_received, upi_received, confirm_mismatch } = req.body;

    const cash = Number(cash_received);
    const upi = Number(upi_received);

    if (isNaN(cash) || isNaN(upi) || cash < 0 || upi < 0) {
      return res.status(400).json({ error: 'Valid non-negative numbers are required for cash and UPI.' });
    }

    const existingClosing = await get(
      `SELECT id FROM daily_closings WHERE stall_id = ? AND business_date = ? AND status = 'ACTIVE'`,
      [stallId, today]
    );

    if (existingClosing) {
      return res.status(409).json({ error: 'Daily closing has already been submitted for today.' });
    }

    // Expected revenue = SUM(quantity * selling_price) net of reversals
    const salesRow = await get(
      `SELECT COALESCE(SUM(quantity), 0) as total_sold, 
              COALESCE(SUM(quantity * selling_price), 0) as total_revenue 
       FROM sales WHERE stall_id = ? AND business_date = ?`,
      [stallId, today]
    );

    const soldTotal = salesRow ? salesRow.total_sold : 0;
    const expectedRevenue = salesRow ? salesRow.total_revenue : 0;
    const totalReceived = cash + upi;

    // IF AMOUNT DOES NOT MATCH EXPECTED REVENUE AND CONFIRMATION IS NOT PRESENT:
    if (totalReceived !== expectedRevenue && !confirm_mismatch) {
      await run(
        `INSERT INTO closing_attempts (business_date, stall_id, attempted_at, cash_received, upi_received)
         VALUES (?, ?, ?, ?, ?)`,
        [today, stallId, utcTimestamp, cash, upi]
      );

      const failedCountRow = await get(
        `SELECT COUNT(*) as count FROM closing_attempts WHERE stall_id = ? AND business_date = ?`,
        [stallId, today]
      );
      const failedTotal = failedCountRow ? failedCountRow.count : 1;

      broadcastEvent('STALL_ACTION', {
        eventType: 'FAILED_CLOSING',
        stall_id: stallId,
        stall_name: `Stall ${stallId}`,
        created_at: utcTimestamp,
        failed_count: failedTotal,
        text: `Closing attempt failed (${failedTotal} total today)`
      });

      return res.status(409).json({
        error: "Amount doesn't match. Re-check, or close anyway.",
        code: "MISMATCH"
      });
    }

    const { stockReceived, wastageToday } = await getStockCounts(stallId, today);
    const actualRemaining = stockReceived - soldTotal - wastageToday;
    const expectedRemaining = actualRemaining;
    const stockVariance = 0;
    const stockVarianceValue = 0.0;
    const moneyDifference = totalReceived - expectedRevenue;
    const stockStatus = 'MATCHED';
    const moneyStatus = moneyDifference === 0 ? 'MATCHED' : (moneyDifference < 0 ? 'SHORT' : 'EXTRA');

    const result = await run(
      `INSERT INTO daily_closings (
        stall_id, business_date, actual_remaining, cash_received, upi_received,
        received_total, sold_total, wastage_total, expected_remaining,
        expected_revenue, stock_variance, stock_variance_value,
        money_difference, stock_status, money_status, submitted_at, submitted_by, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
      [
        stallId, today, actualRemaining, cash, upi,
        stockReceived, soldTotal, wastageToday, expectedRemaining,
        expectedRevenue, stockVariance, stockVarianceValue,
        moneyDifference, stockStatus, moneyStatus, utcTimestamp, req.user.id
      ]
    );

    broadcastEvent('STALL_ACTION', {
      eventType: 'DAY_CLOSED',
      stall_id: stallId,
      stall_name: `Stall ${stallId}`,
      closing_id: result.id,
      created_at: utcTimestamp,
      text: `Stall ${stallId} submitted daily closing`
    });

    return res.json({
      success: true,
      message: 'Day closed',
      closing_id: result.id
    });
  } catch (err) {
    console.error('Close day error:', err);
    return res.status(500).json({ error: err.message || 'Failed to submit daily closing' });
  }
});

module.exports = router;
