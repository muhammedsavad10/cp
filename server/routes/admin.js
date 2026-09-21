const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const JSZip = require('jszip');
const { get, all, run, getISTBusinessDate, getUTCTimestamp } = require('../db');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { getStallStatus, broadcastEvent } = require('../websocket');

router.use(authenticateToken);
router.use(requireRole('ADMIN'));

// Format UTC timestamp string to IST readable string
const formatISTTime = (isoString) => {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  } catch (e) {
    return isoString;
  }
};

// GET /api/admin/dashboard
router.get('/dashboard', async (req, res) => {
  try {
    const today = getISTBusinessDate();

    // Sales metrics (reversals net out)
    const salesRow = await get(
      `SELECT COALESCE(SUM(quantity), 0) as total_sold, 
              COALESCE(SUM(selling_price), 0) as total_revenue 
       FROM sales WHERE business_date = ?`,
      [today]
    );
    const totalSold = salesRow ? salesRow.total_sold : 0;
    const totalRevenue = salesRow ? salesRow.total_revenue : 0;
    const profit = totalRevenue - (totalSold * 20.0);

    // Count of reversals today
    const reversalRow = await get(
      `SELECT COUNT(*) as count FROM sales WHERE business_date = ? AND quantity = -1`,
      [today]
    );
    const reversalsToday = reversalRow ? reversalRow.count : 0;

    // Last sale timestamp
    const lastSale = await get(
      `SELECT created_at FROM sales WHERE stall_id = 1 ORDER BY id DESC LIMIT 1`
    );

    // Stock received today (uses received_business_date)
    const stockRow = await get(
      `SELECT COALESCE(SUM(COALESCE(received_quantity, quantity)), 0) as total 
       FROM stock_dispatches 
       WHERE status = 'RECEIVED' AND received_business_date = ?`,
      [today]
    );
    const totalStockReceived = stockRow ? stockRow.total : 0;

    // Wastage today
    const wastageRow = await get(
      `SELECT COALESCE(SUM(quantity), 0) as total FROM wastages WHERE business_date = ?`,
      [today]
    );
    const totalWastage = wastageRow ? wastageRow.total : 0;

    // Wastage breakdown by reason (including Free sample and Other)
    const wastageBreakdown = await all(
      `SELECT reason, SUM(quantity) as total_quantity 
       FROM wastages 
       WHERE business_date = ? 
       GROUP BY reason`,
      [today]
    );

    const expectedRemaining = totalStockReceived - totalSold - totalWastage;
    const isOverSold = expectedRemaining < 0;
    const isLargeWastage = totalStockReceived > 0 && totalWastage > 0.10 * totalStockReceived;

    // Active closing data for today
    const closing = await get(
      `SELECT * FROM daily_closings WHERE stall_id = 1 AND business_date = ? AND status = 'ACTIVE'`,
      [today]
    );

    // Active or latest session for today
    const activeSession = await get(
      `SELECT * FROM stall_sessions WHERE stall_id = 1 AND business_date = ? AND status = 'ACTIVE'`,
      [today]
    );
    const latestSession = await get(
      `SELECT * FROM stall_sessions WHERE stall_id = 1 AND business_date = ? ORDER BY id DESC LIMIT 1`,
      [today]
    );

    const dayStarted = !!activeSession;
    const dayClosed = !!closing;

    const connStatus = getStallStatus(1);

    // State machine status calculation:
    // NOT_STARTED -> LIVE (started + open + websocket connected) -> OFFLINE (started + open + websocket disconnected) -> CLOSED (closed)
    let stateMachineStatus = 'NOT_STARTED';
    if (dayClosed) {
      stateMachineStatus = 'CLOSED';
    } else if (dayStarted) {
      stateMachineStatus = connStatus.isOnline ? 'LIVE' : 'OFFLINE';
    }

    // Activity feed generated from actual database records
    const salesList = await all(
      `SELECT 'SALE' as type, id, 
              CASE WHEN quantity = 1 THEN 'Stall 1 sold 1 Butter Fruit Payasam' 
                   ELSE 'Stall 1 reversed sale #' || reversal_of END as description, 
              created_at 
       FROM sales WHERE business_date = ? 
       ORDER BY id DESC LIMIT 15`,
      [today]
    );

    const dispatchList = await all(
      `SELECT 'DISPATCH' as type, id, 
              ('Stall 1 stock dispatched: ' || quantity || ' glasses') as description, 
              created_at 
       FROM stock_dispatches WHERE DATE(created_at, 'localtime') = DATE('now', 'localtime') 
       ORDER BY id DESC LIMIT 15`
    );

    const receiptList = await all(
      `SELECT 'RECEIPT' as type, id, 
              CASE WHEN received_quantity != quantity THEN 'Stall 1 confirmed receipt of ' || received_quantity || ' glasses (Dispatched: ' || quantity || ' — ' || CASE WHEN received_quantity < quantity THEN 'SHORT ' || (quantity - received_quantity) ELSE 'MORE ' || (received_quantity - quantity) END || ')' 
                   ELSE 'Stall 1 confirmed receipt of ' || received_quantity || ' glasses' END as description, 
              received_at as created_at 
       FROM stock_dispatches WHERE status = 'RECEIVED' AND received_business_date = ? 
       ORDER BY id DESC LIMIT 15`,
      [today]
    );

    const wastageList = await all(
      `SELECT 'WASTAGE' as type, id, 
              ('Stall 1 recorded ' || quantity || ' wastage (' || reason || ')') as description, 
              created_at 
       FROM wastages WHERE business_date = ? 
       ORDER BY id DESC LIMIT 15`,
      [today]
    );

    const closingList = await all(
      `SELECT 'CLOSING' as type, id, 
              ('Stall 1 submitted daily closing (Money: ' || money_status || ')') as description, 
              submitted_at as created_at 
       FROM daily_closings WHERE business_date = ? AND status = 'ACTIVE' 
       ORDER BY id DESC LIMIT 15`,
      [today]
    );

    const failedClosingList = await all(
      `SELECT 'FAILED_CLOSING' as type, id,
              ('Closing attempt failed (' || (SELECT COUNT(*) FROM closing_attempts ca2 WHERE ca2.stall_id = ca.stall_id AND ca2.business_date = ca.business_date AND ca2.id <= ca.id) || ' total today)') as description,
              attempted_at as created_at
       FROM closing_attempts ca WHERE business_date = ?
       ORDER BY id DESC LIMIT 15`,
      [today]
    );

    const combinedActivity = [...salesList, ...dispatchList, ...receiptList, ...wastageList, ...closingList, ...failedClosingList]
      .filter(item => item.created_at)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 20);

    return res.json({
      today,
      metrics: {
        totalSold,
        totalRevenue,
        profit,
        reversalsToday,
        totalStockReceived,
        totalWastage,
        expectedRemaining,
        isOverSold,
        isLargeWastage,
        wastageBreakdown,
        dayStarted,
        dayClosed,
        closingSubmitted: !!closing,
        closingStatus: closing ? closing.status : (dayStarted ? 'OPEN' : 'NOT_STARTED')
      },
      stall1Status: {
        id: 1,
        name: 'Stall 1',
        received: totalStockReceived,
        sold: totalSold,
        wastage: totalWastage,
        expectedRemaining,
        revenue: totalRevenue,
        profit,
        lastSaleTime: lastSale ? lastSale.created_at : null,
        isOnline: connStatus.isOnline,
        lastSeen: connStatus.lastSeen,
        status: stateMachineStatus,
        started_at: latestSession ? latestSession.started_at : null,
        closed_at: closing ? closing.submitted_at : null
      },
      closing: closing ? {
        stock_status: closing.stock_status,
        stock_variance: closing.stock_variance,
        stock_variance_value: closing.stock_variance_value,
        money_status: closing.money_status,
        money_difference: closing.money_difference,
        actual_remaining: closing.actual_remaining,
        cash_received: closing.cash_received,
        upi_received: closing.upi_received,
        expected_revenue: closing.expected_revenue,
        submitted_at: closing.submitted_at
      } : null,
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
    const qty = Number(quantity);

    if (isNaN(qty) || qty < 1 || qty > 500) {
      return res.status(400).json({ error: 'Dispatch quantity must be an integer between 1 and 500' });
    }

    const utcTimestamp = getUTCTimestamp();

    await run(
      `INSERT INTO stock_dispatches (stall_id, product_id, quantity, dispatched_by, created_at, status)
       VALUES (?, ?, ?, ?, ?, 'DISPATCHED')`,
      [stall_id, product_id, qty, req.user.id, utcTimestamp]
    );

    // Broadcast Real-Time Event
    broadcastEvent('STALL_ACTION', {
      eventType: 'DISPATCH',
      stall_id,
      stall_name: `Stall ${stall_id}`,
      quantity: qty,
      created_at: utcTimestamp,
      text: `Admin dispatched ${qty} glasses to Stall ${stall_id}`
    });

    return res.json({ success: true, message: `Successfully dispatched ${qty} glasses to Stall ${stall_id}` });
  } catch (err) {
    console.error('Dispatch error:', err);
    return res.status(500).json({ error: 'Failed to dispatch stock' });
  }
});

// POST /api/admin/void-sale
router.post('/void-sale', async (req, res) => {
  try {
    const { sale_id, reason } = req.body;
    if (!sale_id || !reason) {
      return res.status(400).json({ error: 'sale_id and void reason are required' });
    }

    const sale = await get('SELECT * FROM sales WHERE id = ?', [sale_id]);
    if (!sale) {
      return res.status(404).json({ error: 'Sale record not found' });
    }

    if (sale.quantity !== 1) {
      return res.status(400).json({ error: 'Cannot void a reversal record' });
    }

    // Check if sale is already reversed
    const existingReversal = await get('SELECT id FROM sales WHERE reversal_of = ?', [sale_id]);
    if (existingReversal) {
      return res.status(400).json({ error: 'Sale is already voided/reversed' });
    }

    // Check if sale's business_date has an ACTIVE closing
    const activeClosing = await get(
      `SELECT id FROM daily_closings WHERE stall_id = ? AND business_date = ? AND status = 'ACTIVE'`,
      [sale.stall_id, sale.business_date]
    );

    if (activeClosing) {
      return res.status(400).json({ error: 'Cannot void sale on a closed day.' });
    }

    const utcTimestamp = getUTCTimestamp();
    const voidIdempotencyKey = `void_${sale.id}_${Date.now()}`;

    await run(
      `INSERT INTO sales (stall_id, product_id, quantity, selling_price, created_at, created_by, business_date, idempotency_key, reversal_of, reversal_reason)
       VALUES (?, ?, -1, ?, ?, ?, ?, ?, ?, ?)`,
      [sale.stall_id, sale.product_id, sale.selling_price, utcTimestamp, req.user.id, sale.business_date, voidIdempotencyKey, sale.id, reason]
    );

    // Broadcast Real-Time Event
    broadcastEvent('STALL_ACTION', {
      eventType: 'VOID_SALE',
      stall_id: sale.stall_id,
      sale_id: sale.id,
      reason,
      created_at: utcTimestamp,
      text: `Admin voided sale #${sale.id} (${reason})`
    });

    return res.json({ success: true, message: `Sale #${sale.id} voided successfully` });
  } catch (err) {
    console.error('Admin void sale error:', err);
    return res.status(500).json({ error: err.message || 'Failed to void sale' });
  }
});

// POST /api/admin/reopen-day
router.post('/reopen-day', async (req, res) => {
  try {
    const { stall_id = 1, business_date, reason } = req.body;
    if (!business_date || !reason) {
      return res.status(400).json({ error: 'business_date and reason are required to reopen a day' });
    }

    const closing = await get(
      `SELECT * FROM daily_closings WHERE stall_id = ? AND business_date = ? AND status = 'ACTIVE'`,
      [stall_id, business_date]
    );

    if (!closing) {
      return res.status(404).json({ error: `No active daily closing found for ${business_date}` });
    }

    const utcTimestamp = getUTCTimestamp();

    await run(
      `UPDATE daily_closings 
       SET status = 'VOID', void_reason = ?, voided_by = ?, voided_at = ? 
       WHERE id = ?`,
      [reason, req.user.id, utcTimestamp, closing.id]
    );

    // Re-mark session active so the stall can go Live again (T1.5-1)
    const existingSession = await get(
      `SELECT id FROM stall_sessions WHERE stall_id = ? AND business_date = ? ORDER BY id DESC LIMIT 1`,
      [stall_id, business_date]
    );

    if (existingSession) {
      await run(
        `UPDATE stall_sessions SET status = 'ACTIVE' WHERE id = ?`,
        [existingSession.id]
      );
    } else {
      await run(
        `INSERT INTO stall_sessions (stall_id, business_date, started_at, started_by, status)
         VALUES (?, ?, ?, ?, 'ACTIVE')`,
        [stall_id, business_date, utcTimestamp, req.user.id]
      );
    }

    // Broadcast Real-Time Event
    broadcastEvent('STALL_ACTION', {
      eventType: 'REOPEN_DAY',
      stall_id,
      business_date,
      reason,
      created_at: utcTimestamp,
      text: `Admin reopened day ${business_date} for Stall ${stall_id} (${reason})`
    });

    return res.json({ success: true, message: `Day ${business_date} reopened successfully` });
  } catch (err) {
    console.error('Reopen day error:', err);
    return res.status(500).json({ error: 'Failed to reopen day' });
  }
});

// GET /api/admin/sales
router.get('/sales', async (req, res) => {
  try {
    const today = getISTBusinessDate();

    const sales = await all(
      `SELECT s.id, s.quantity, s.selling_price, s.created_at, s.business_date, s.reversal_of, s.reversal_reason, p.name as product_name, u.name as user_name 
       FROM sales s
       JOIN products p ON s.product_id = p.id
       JOIN users u ON s.created_by = u.id
       WHERE s.business_date = ?
       ORDER BY s.id DESC`,
      [today]
    );

    const revenueRow = await get(
      `SELECT COALESCE(SUM(selling_price), 0) as total_revenue, 
              COALESCE(SUM(quantity), 0) as total_sold 
       FROM sales WHERE business_date = ?`,
      [today]
    );

    return res.json({
      today,
      totalSales: revenueRow ? revenueRow.total_sold : 0,
      totalRevenue: revenueRow ? revenueRow.total_revenue : 0,
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
    const today = getISTBusinessDate();

    const dispatches = await all(
      `SELECT d.*, u1.name as dispatched_by_name, u2.name as received_by_name, p.name as product_name 
       FROM stock_dispatches d
       JOIN products p ON d.product_id = p.id
       JOIN users u1 ON d.dispatched_by = u1.id
       LEFT JOIN users u2 ON d.received_by = u2.id
       WHERE d.received_business_date = ? OR (d.status = 'DISPATCHED' AND DATE(d.created_at, 'localtime') = DATE('now', 'localtime'))
       ORDER BY d.id DESC`,
      [today]
    );

    const receivedRow = await get(
      `SELECT COALESCE(SUM(COALESCE(received_quantity, quantity)), 0) as total FROM stock_dispatches WHERE status = 'RECEIVED' AND received_business_date = ?`,
      [today]
    );
    const totalReceived = receivedRow ? receivedRow.total : 0;

    const salesRow = await get(
      `SELECT COALESCE(SUM(quantity), 0) as total FROM sales WHERE business_date = ?`,
      [today]
    );
    const totalSold = salesRow ? salesRow.total : 0;

    const wastageRow = await get(
      `SELECT COALESCE(SUM(quantity), 0) as total FROM wastages WHERE business_date = ?`,
      [today]
    );
    const totalWastage = wastageRow ? wastageRow.total : 0;

    const expectedRemaining = totalReceived - totalSold - totalWastage;

    const closing = await get(
      `SELECT * FROM daily_closings WHERE stall_id = 1 AND business_date = ? AND status = 'ACTIVE'`,
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
    const today = getISTBusinessDate();

    const revenueRow = await get(
      `SELECT COALESCE(SUM(selling_price), 0) as total FROM sales WHERE business_date = ?`,
      [today]
    );
    const expectedRevenue = revenueRow ? revenueRow.total : 0;

    const closing = await get(
      `SELECT * FROM daily_closings WHERE stall_id = 1 AND business_date = ? AND status = 'ACTIVE'`,
      [today]
    );

    return res.json({
      today,
      expectedRevenue,
      cash: closing ? closing.cash_received : 0,
      upi: closing ? closing.upi_received : 0,
      totalReceived: closing ? closing.cash_received + closing.upi_received : 0,
      moneyDifference: closing ? closing.money_difference : null,
      moneyStatus: closing ? closing.money_status : 'UNCLOSED',
      stockStatus: closing ? closing.stock_status : 'UNCLOSED',
      stockVariance: closing ? closing.stock_variance : null,
      stockVarianceValue: closing ? closing.stock_variance_value : null,
      isClosed: !!closing
    });
  } catch (err) {
    console.error('Admin money error:', err);
    return res.status(500).json({ error: 'Failed to fetch money reconciliation' });
  }
});

// GET /api/admin/reports
router.get('/reports', async (req, res) => {
  try {
    const today = getISTBusinessDate();
    const product = await get('SELECT * FROM products WHERE id = 1');
    const directCost = product ? product.direct_cost : 20.0;

    const salesRow = await get(
      `SELECT COALESCE(SUM(quantity), 0) as total_sold, 
              COALESCE(SUM(quantity * selling_price), 0) as total_revenue 
       FROM sales WHERE business_date = ?`,
      [today]
    );

    const totalSold = salesRow ? salesRow.total_sold : 0;
    const totalRevenue = salesRow ? salesRow.total_revenue : 0;
    const totalProductCost = totalSold * directCost;
    const staffCost = 0.0;
    const estimatedOperatingProfit = totalRevenue - totalProductCost - staffCost;

    return res.json({
      date: today,
      totalGlassesSold: totalSold,
      sellingPrice: 40.0,
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

// GET /api/admin/backup (Consistent SQLite snapshot via VACUUM INTO)
router.get('/backup', async (req, res) => {
  try {
    const today = getISTBusinessDate();
    const backupFileName = `backup-${today}-${Date.now()}.db`;
    const dataDir = process.env.DATA_DIR
      ? path.resolve(process.env.DATA_DIR)
      : path.join(__dirname, '../../data');

    const backupPath = path.join(dataDir, backupFileName);

    await run(`VACUUM INTO ?`, [backupPath]);

    res.download(backupPath, backupFileName, (err) => {
      // Cleanup temp backup file after download
      if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
      }
    });
  } catch (err) {
    console.error('Backup error:', err);
    return res.status(500).json({ error: 'Database backup failed: ' + err.message });
  }
});

// GET /api/admin/export.csv?from=&to=
router.get('/export.csv', async (req, res) => {
  try {
    const fromDate = req.query.from || getISTBusinessDate();
    const toDate = req.query.to || getISTBusinessDate();

    const sales = await all(`SELECT * FROM sales WHERE business_date BETWEEN ? AND ? ORDER BY id ASC`, [fromDate, toDate]);
    const wastages = await all(`SELECT * FROM wastages WHERE business_date BETWEEN ? AND ? ORDER BY id ASC`, [fromDate, toDate]);
    const dispatches = await all(`SELECT * FROM stock_dispatches WHERE received_business_date BETWEEN ? AND ? ORDER BY id ASC`, [fromDate, toDate]);
    const closings = await all(`SELECT * FROM daily_closings WHERE business_date BETWEEN ? AND ? ORDER BY id ASC`, [fromDate, toDate]);

    const toCSV = (rows) => {
      if (!rows || rows.length === 0) return '';
      const headers = Object.keys(rows[0]).join(',');
      const body = rows.map(r => Object.values(r).map(v => `"${v !== null && v !== undefined ? String(v).replace(/"/g, '""') : ''}"`).join(',')).join('\n');
      return `${headers}\n${body}`;
    };

    const zip = new JSZip();
    zip.file(`sales_${fromDate}_to_${toDate}.csv`, toCSV(sales));
    zip.file(`wastages_${fromDate}_to_${toDate}.csv`, toCSV(wastages));
    zip.file(`dispatches_${fromDate}_to_${toDate}.csv`, toCSV(dispatches));
    zip.file(`daily_closings_${fromDate}_to_${toDate}.csv`, toCSV(closings));

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename=payasam_export_${fromDate}_to_${toDate}.zip`);
    return res.send(zipBuffer);
  } catch (err) {
    console.error('CSV Export error:', err);
    return res.status(500).json({ error: 'Export failed: ' + err.message });
  }
});

module.exports = router;
