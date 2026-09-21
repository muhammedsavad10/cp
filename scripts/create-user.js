const readline = require('readline');
const bcrypt = require('bcryptjs');
const { run, get } = require('../server/db');

async function main() {
  const args = process.argv.slice(2);
  const emailArg = args[0];
  const nameArg = args[1];
  const roleArg = args[2] || 'STALL_USER';
  const stallIdArg = args[3] ? Number(args[3]) : (roleArg === 'STALL_USER' ? 1 : null);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (query) => new Promise((resolve) => rl.question(query, resolve));

  try {
    const email = emailArg || await question('Enter user email: ');
    const name = nameArg || await question('Enter user name: ');
    const role = roleArg || await question('Enter role (ADMIN / STALL_USER): ');
    const stallIdStr = stallIdArg !== undefined ? stallIdArg : await question('Enter stall ID (default 1 for STALL_USER): ');
    const password = await question('Enter user password: ');

    if (!email || !name || !password) {
      console.error('Email, name, and password are required.');
      process.exit(1);
    }

    const existing = await get('SELECT * FROM users WHERE email = ?', [email]);
    if (existing) {
      console.error(`User with email ${email} already exists.`);
      process.exit(1);
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const finalStallId = role === 'ADMIN' ? null : (Number(stallIdStr) || 1);

    await run(
      `INSERT INTO users (name, email, password, role, stall_id) VALUES (?, ?, ?, ?, ?)`,
      [name, email, hashedPassword, role, finalStallId]
    );

    console.log(`✓ User created successfully: ${email} (${role}, stall_id: ${finalStallId})`);
  } catch (err) {
    console.error('Error creating user:', err);
  } finally {
    rl.close();
    process.exit(0);
  }
}

main();
