// ops/create-users.js
// Idempotently creates or resets user accounts using server/db.js helpers without modifying server code.

const path = require('path');
const bcrypt = require('bcryptjs');

if (!process.env.DATA_DIR) {
  console.error('ERROR: DATA_DIR environment variable is required.');
  process.exit(1);
}

const { run, get } = require('../server/db');

async function createOrUpdateUser(name, email, password, role, stallId, reset = false) {
  const normalizedEmail = email.toLowerCase().trim();
  const existing = await get('SELECT * FROM users WHERE email = ?', [normalizedEmail]);

  const hash = await bcrypt.hash(password, 10);

  if (existing) {
    if (reset) {
      await run('UPDATE users SET name = ?, password = ?, role = ?, stall_id = ? WHERE email = ?', [
        name,
        hash,
        role,
        stallId,
        normalizedEmail
      ]);
      console.log(`User ${normalizedEmail} updated/reset successfully.`);
    } else {
      console.log(`User ${normalizedEmail} already exists. Skipping (use -Reset to update password).`);
    }
  } else {
    await run('INSERT INTO users (name, email, password, role, stall_id) VALUES (?, ?, ?, ?, ?)', [
      name,
      normalizedEmail,
      hash,
      role,
      stallId
    ]);
    console.log(`User ${normalizedEmail} created successfully.`);
  }
}

async function main() {
  await new Promise(r => setTimeout(r, 1000));

  const args = process.argv.slice(2);
  const resetFlag = args.includes('--reset') || args.includes('-Reset');

  const adminEmail = process.env.ADMIN_EMAIL || 'admin@pay.local';
  const adminPass = process.env.ADMIN_PASSWORD;

  const stallEmail = process.env.STALL_EMAIL || 'stall1@pay.local';
  const stallPass = process.env.STALL_PASSWORD;

  if (adminPass) {
    await createOrUpdateUser('System Administrator', adminEmail, adminPass, 'ADMIN', null, resetFlag);
  }

  if (stallPass) {
    await createOrUpdateUser('Stall 1 Worker', stallEmail, stallPass, 'STALL_USER', 1, resetFlag);
  }
}

main().then(() => process.exit(0)).catch(err => {
  console.error('User creation failed:', err);
  process.exit(1);
});
