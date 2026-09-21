import React, { useState } from 'react';
import { api, setToken, setUser } from '../api';

export default function Login({ onLoginSuccess }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e, demoEmail, demoPass) => {
    if (e) e.preventDefault();
    const loginEmail = demoEmail || email;
    const loginPass = demoPass || password;

    if (!loginEmail || !loginPass) {
      setError('Please enter both email and password.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const data = await api.login({ email: loginEmail, password: loginPass });
      setToken(data.token);
      setUser(data.user);
      onLoginSuccess(data.user);
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-container" style={{ justifyContent: 'center', padding: 20 }}>
      <div className="card" style={{ padding: 28, boxShadow: 'var(--shadow-lg)' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <h1 style={{ fontSize: '1.8rem', fontWeight: 900, color: '#064e3b' }}>COLD PAYASAM</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', fontWeight: 600 }}>Stall 1 & Admin Operations</p>
        </div>

        {error && (
          <div className="badge badge-danger" style={{ width: '100%', marginBottom: 16, justifyContent: 'center', padding: 10 }}>
            {error}
          </div>
        )}

        <form onSubmit={(e) => handleLogin(e)}>
          <div className="form-group">
            <label className="form-label">Email Address</label>
            <input
              type="email"
              className="form-input"
              placeholder="worker@test.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              type="password"
              className="form-input"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button type="submit" className="btn-submit" disabled={loading}>
            {loading ? 'Logging in...' : 'LOGIN'}
          </button>
        </form>

        <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid #e2e8f0', textAlign: 'center' }}>
          <p style={{ fontSize: '0.85rem', color: '#64748b', fontWeight: 700, marginBottom: 12 }}>
            DEMO QUICK LOGIN
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <button
              type="button"
              className="btn-action"
              style={{ background: '#dcfce7', color: '#15803d', fontSize: '0.9rem', padding: 10 }}
              onClick={() => handleLogin(null, 'stall1@test.com', 'stall123')}
            >
              Stall 1 Worker
            </button>

            <button
              type="button"
              className="btn-action"
              style={{ background: '#e0e7ff', color: '#4338ca', fontSize: '0.9rem', padding: 10 }}
              onClick={() => handleLogin(null, 'admin@test.com', 'admin123')}
            >
              Admin
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
