const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { get } = require('../db');
const { JWT_SECRET, authenticateToken } = require('../middleware/auth');

// In-memory rate limiting map for login: ip:email -> { count, resetTime }
const loginAttempts = new Map();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
    const key = `${clientIp}:${email.toLowerCase().trim()}`;
    const now = Date.now();

    const attempt = loginAttempts.get(key) || { count: 0, resetTime: now + 15 * 60 * 1000 };

    if (now > attempt.resetTime) {
      attempt.count = 0;
      attempt.resetTime = now + 15 * 60 * 1000;
    }

    if (attempt.count >= 10) {
      const waitMinutes = Math.ceil((attempt.resetTime - now) / (60 * 1000));
      return res.status(429).json({
        error: `Too many failed login attempts. Please try again in ${waitMinutes} minute(s).`
      });
    }

    const user = await get('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    if (!user) {
      attempt.count += 1;
      loginAttempts.set(key, attempt);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const validPass = await bcrypt.compare(password, user.password);
    if (!validPass) {
      attempt.count += 1;
      loginAttempts.set(key, attempt);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Success -> clear rate limit counter
    loginAttempts.delete(key);

    const payload = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      stall_id: user.stall_id
    };

    // Stall token = 7d, Admin token = 12h
    const expiresIn = user.role === 'ADMIN' ? '12h' : '7d';
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn });

    return res.json({
      token,
      user: payload
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/auth/me
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await get('SELECT id, name, email, role, stall_id FROM users WHERE id = ?', [req.user.id]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.json({ user });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
