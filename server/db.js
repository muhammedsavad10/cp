const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '../data');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'payasam.db');
const db = new sqlite3.Database(dbPath);

// Helper function for IST Business Date (YYYY-MM-DD in Asia/Kolkata)
const getISTBusinessDate = (dateObj = new Date()) => {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(dateObj);
};

// Helper function for ISO-8601 UTC timestamp
const getUTCTimestamp = (dateObj = new Date()) => {
  return dateObj.toISOString();
};

const run = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
};

const get = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const all = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

// Initialize schema, pragmas, triggers, and seed data
const initDb = async () => {
  db.serialize(async () => {
    // SQLite Pragmas
    db.run('PRAGMA foreign_keys = ON');
    db.run('PRAGMA journal_mode = WAL');
    db.run('PRAGMA busy_timeout = 5000');

    // Create Tables with CHECK constraints
    await run(`
      CREATE TABLE IF NOT EXISTS stalls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        active INTEGER DEFAULT 1
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT CHECK(role IN ('ADMIN', 'STALL_USER')) NOT NULL,
        stall_id INTEGER REFERENCES stalls(id)
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        selling_price REAL NOT NULL,
        direct_cost REAL NOT NULL
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS stock_dispatches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stall_id INTEGER NOT NULL REFERENCES stalls(id),
        product_id INTEGER NOT NULL REFERENCES products(id),
        quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 500),
        created_at TEXT NOT NULL,
        dispatched_by INTEGER NOT NULL REFERENCES users(id),
        received_at TEXT,
        received_by INTEGER REFERENCES users(id),
        received_quantity INTEGER CHECK(received_quantity IS NULL OR received_quantity BETWEEN 0 AND 500),
        received_business_date TEXT,
        status TEXT CHECK(status IN ('DISPATCHED', 'RECEIVED')) DEFAULT 'DISPATCHED'
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS sales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stall_id INTEGER NOT NULL REFERENCES stalls(id),
        product_id INTEGER NOT NULL REFERENCES products(id),
        quantity INTEGER NOT NULL CHECK(quantity IN (1, -1)),
        selling_price REAL NOT NULL,
        created_at TEXT NOT NULL,
        created_by INTEGER NOT NULL REFERENCES users(id),
        business_date TEXT NOT NULL,
        idempotency_key TEXT UNIQUE NOT NULL,
        reversal_of INTEGER UNIQUE REFERENCES sales(id),
        reversal_reason TEXT,
        CHECK (
          (quantity = 1 AND reversal_of IS NULL) OR
          (quantity = -1 AND reversal_of IS NOT NULL)
        )
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS wastages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stall_id INTEGER NOT NULL REFERENCES stalls(id),
        product_id INTEGER NOT NULL REFERENCES products(id),
        quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 200),
        reason TEXT NOT NULL CHECK(reason IN ('Spoiled', 'Spilled', 'Damaged', 'Free sample', 'Other')),
        created_at TEXT NOT NULL,
        created_by INTEGER NOT NULL REFERENCES users(id),
        business_date TEXT NOT NULL
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS daily_closings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stall_id INTEGER NOT NULL REFERENCES stalls(id),
        business_date TEXT NOT NULL,
        actual_remaining INTEGER NOT NULL,
        cash_received REAL NOT NULL CHECK(cash_received >= 0),
        upi_received REAL NOT NULL CHECK(upi_received >= 0),
        received_total INTEGER NOT NULL,
        sold_total INTEGER NOT NULL,
        wastage_total INTEGER NOT NULL,
        expected_remaining INTEGER NOT NULL,
        expected_revenue REAL NOT NULL,
        stock_variance INTEGER NOT NULL,
        stock_variance_value REAL NOT NULL,
        money_difference REAL NOT NULL,
        stock_status TEXT NOT NULL CHECK(stock_status IN ('MATCHED', 'SHORT', 'EXTRA')),
        money_status TEXT NOT NULL CHECK(money_status IN ('MATCHED', 'SHORT', 'EXTRA')),
        status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'VOID')) DEFAULT 'ACTIVE',
        void_reason TEXT,
        voided_by INTEGER REFERENCES users(id),
        voided_at TEXT,
        submitted_at TEXT NOT NULL,
        submitted_by INTEGER NOT NULL REFERENCES users(id)
      )
    `);

    // Partial UNIQUE Index for Daily Closings
    await run(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_closings_active 
      ON daily_closings(stall_id, business_date) 
      WHERE status = 'ACTIVE'
    `);

    // Stall Sessions (Day Lifecycle)
    await run(`
      CREATE TABLE IF NOT EXISTS stall_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stall_id INTEGER NOT NULL REFERENCES stalls(id),
        business_date TEXT NOT NULL,
        started_at TEXT NOT NULL,
        started_by INTEGER NOT NULL REFERENCES users(id),
        status TEXT CHECK(status IN ('ACTIVE', 'CLOSED')) DEFAULT 'ACTIVE'
      )
    `);

    await run(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_stall_sessions_active 
      ON stall_sessions(stall_id, business_date) 
      WHERE status = 'ACTIVE'
    `);

    // Closing Attempts Audit Log
    await run(`
      CREATE TABLE IF NOT EXISTS closing_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stall_id INTEGER NOT NULL REFERENCES stalls(id),
        business_date TEXT NOT NULL,
        attempted_at TEXT NOT NULL,
        cash_received REAL NOT NULL,
        upi_received REAL NOT NULL
      )
    `);

    // Triggers for Ledger Integrity
    await run(`
      CREATE TRIGGER IF NOT EXISTS prevent_sales_update 
      BEFORE UPDATE ON sales BEGIN 
        SELECT RAISE(ABORT, 'sales table is append-only: UPDATE prohibited'); 
      END;
    `);

    await run(`
      CREATE TRIGGER IF NOT EXISTS prevent_sales_delete 
      BEFORE DELETE ON sales BEGIN 
        SELECT RAISE(ABORT, 'sales table is append-only: DELETE prohibited'); 
      END;
    `);

    await run(`
      CREATE TRIGGER IF NOT EXISTS prevent_wastages_update 
      BEFORE UPDATE ON wastages BEGIN 
        SELECT RAISE(ABORT, 'wastages table is append-only: UPDATE prohibited'); 
      END;
    `);

    await run(`
      CREATE TRIGGER IF NOT EXISTS prevent_wastages_delete 
      BEFORE DELETE ON wastages BEGIN 
        SELECT RAISE(ABORT, 'wastages table is append-only: DELETE prohibited'); 
      END;
    `);

    await run(`
      CREATE TRIGGER IF NOT EXISTS prevent_dispatches_delete 
      BEFORE DELETE ON stock_dispatches BEGIN 
        SELECT RAISE(ABORT, 'stock_dispatches table does not allow DELETE'); 
      END;
    `);

    await run(`
      CREATE TRIGGER IF NOT EXISTS restrict_dispatches_update 
      BEFORE UPDATE ON stock_dispatches BEGIN 
        SELECT CASE 
          WHEN OLD.id != NEW.id OR OLD.stall_id != NEW.stall_id OR OLD.product_id != NEW.product_id 
               OR OLD.quantity != NEW.quantity OR OLD.created_at != NEW.created_at OR OLD.dispatched_by != NEW.dispatched_by 
          THEN RAISE(ABORT, 'restricted column update on stock_dispatches prohibited') 
        END; 
      END;
    `);

    await run(`
      CREATE TRIGGER IF NOT EXISTS prevent_closings_delete 
      BEFORE DELETE ON daily_closings BEGIN 
        SELECT RAISE(ABORT, 'daily_closings table does not allow DELETE'); 
      END;
    `);

    await run(`
      CREATE TRIGGER IF NOT EXISTS restrict_closings_update 
      BEFORE UPDATE ON daily_closings BEGIN 
        SELECT CASE 
          WHEN OLD.id != NEW.id OR OLD.stall_id != NEW.stall_id OR OLD.business_date != NEW.business_date 
               OR OLD.actual_remaining != NEW.actual_remaining OR OLD.cash_received != NEW.cash_received 
               OR OLD.upi_received != NEW.upi_received OR OLD.received_total != NEW.received_total 
               OR OLD.sold_total != NEW.sold_total OR OLD.wastage_total != NEW.wastage_total 
               OR OLD.expected_remaining != NEW.expected_remaining OR OLD.expected_revenue != NEW.expected_revenue 
               OR OLD.stock_variance != NEW.stock_variance OR OLD.stock_variance_value != NEW.stock_variance_value 
               OR OLD.money_difference != NEW.money_difference OR OLD.stock_status != NEW.stock_status 
               OR OLD.money_status != NEW.money_status OR OLD.submitted_at != NEW.submitted_at 
               OR OLD.submitted_by != NEW.submitted_by 
          THEN RAISE(ABORT, 'restricted column update on daily_closings prohibited') 
        END; 
      END;
    `);

    // Seed Stall 1
    let stall = await get(`SELECT * FROM stalls WHERE id = 1`);
    if (!stall) {
      await run(`INSERT INTO stalls (id, name, active) VALUES (1, 'Stall 1', 1)`);
    }

    // Seed Product (Butter Fruit Payasam, price: 40, cost: 20)
    let product = await get(`SELECT * FROM products WHERE id = 1`);
    if (!product) {
      await run(`INSERT INTO products (id, name, selling_price, direct_cost) VALUES (1, 'Butter Fruit Payasam', 40.0, 20.0)`);
    } else {
      await run(`UPDATE products SET selling_price = 40.0, direct_cost = 20.0 WHERE id = 1`);
    }

    // Seed Demo Users ONLY when NODE_ENV !== 'production'
    if (process.env.NODE_ENV !== 'production') {
      const adminPassHash = await bcrypt.hash('admin123', 10);
      const stallPassHash = await bcrypt.hash('stall123', 10);

      let admin = await get(`SELECT * FROM users WHERE email = 'admin@test.com'`);
      if (!admin) {
        await run(
          `INSERT INTO users (name, email, password, role, stall_id) VALUES ('System Admin', 'admin@test.com', ?, 'ADMIN', NULL)`,
          [adminPassHash]
        );
      }

      let stallUser = await get(`SELECT * FROM users WHERE email = 'stall1@test.com'`);
      if (!stallUser) {
        await run(
          `INSERT INTO users (name, email, password, role, stall_id) VALUES ('Stall 1 Worker', 'stall1@test.com', ?, 'STALL_USER', 1)`,
          [stallPassHash]
        );
      }
    }

    console.log('Database initialized successfully with pragmas, schema, triggers, and seed configuration.');
  });
};

initDb();

module.exports = {
  db,
  run,
  get,
  all,
  getISTBusinessDate,
  getUTCTimestamp
};
