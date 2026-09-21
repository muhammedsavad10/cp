const readline = require('readline');
const bcrypt = require('bcryptjs');
const { run, get } = require('../server/db');

async function main() {
  const args = process.argv.slice(2);
  const emailArg = args[0];

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (query) => new Promise((resolve) => rl.question(query, resolve));

  try {
    const email = emailArg || await question('Enter user email to reset password: ');
    if (!email) {
      console.error('Email is required.');
      process.exit(1);
    }

    const user = await get('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) {
      console.error(`User with email ${email} not found.`);
      process.exit(1);
    }

    const newPassword = await question(`Enter new password for ${email}: `);
    if (!newPassword) {
      console.error('Password cannot be empty.');
      process.exit(1);
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await run('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, user.id]);

    console.log(`✓ Password reset successfully for ${email}.`);
  } catch (err) {
    console.error('Error resetting password:', err);
  } finally {
    rl.close();
    process.exit(0);
  }
}

main();
