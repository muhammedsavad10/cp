const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'payasam.db');
const db = new sqlite3.Database(dbPath);

// Helper to run query with promise
const run = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
};

// Helper to get single row
const get = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

// Helper to get all rows
const all = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

// Initialize schema and seed data
const initDb = async () => {
  db.serialize(async () => {
    // Enable Foreign Keys
    db.run('PRAGMA foreign_keys = ON');

    // Create Tables
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
        role TEXT NOT NULL,
        stall_id INTEGER,
        FOREIGN KEY (stall_id) REFERENCES stalls(id)
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
        stall_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        dispatched_by INTEGER NOT NULL,
        received_at DATETIME,
        received_by INTEGER,
        status TEXT DEFAULT 'DISPATCHED',
        FOREIGN KEY (stall_id) REFERENCES stalls(id),
        FOREIGN KEY (product_id) REFERENCES products(id),
        FOREIGN KEY (dispatched_by) REFERENCES users(id),
        FOREIGN KEY (received_by) REFERENCES users(id)
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS sales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stall_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        quantity INTEGER DEFAULT 1,
        selling_price REAL NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_by INTEGER NOT NULL,
        FOREIGN KEY (stall_id) REFERENCES stalls(id),
        FOREIGN KEY (product_id) REFERENCES products(id),
        FOREIGN KEY (created_by) REFERENCES users(id)
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS wastages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stall_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        reason TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_by INTEGER NOT NULL,
        FOREIGN KEY (stall_id) REFERENCES stalls(id),
        FOREIGN KEY (product_id) REFERENCES products(id),
        FOREIGN KEY (created_by) REFERENCES users(id)
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS daily_closings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stall_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        actual_remaining INTEGER NOT NULL,
        cash_received REAL NOT NULL,
        upi_received REAL NOT NULL,
        expected_revenue REAL NOT NULL,
        total_received REAL NOT NULL,
        discrepancy REAL NOT NULL,
        submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        submitted_by INTEGER NOT NULL,
        FOREIGN KEY (stall_id) REFERENCES stalls(id),
        FOREIGN KEY (submitted_by) REFERENCES users(id)
      )
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
      // Ensure prices match requirement
      await run(`UPDATE products SET selling_price = 40.0, direct_cost = 20.0 WHERE id = 1`);
    }

    // Seed Demo Users
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

    console.log('Database initialized successfully with schema and seed data.');
  });
};

initDb();

module.exports = {
  db,
  run,
  get,
  all
};
