import React, { useState } from 'react';
import { Eye, EyeOff, Lock, Mail, LogIn } from 'lucide-react';
import { api, setToken, setUser } from '../api';

export default function Login({ onLoginSuccess }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e) => {
    if (e) e.preventDefault();

    if (!email || !password) {
      setError('Please enter both email and password.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const data = await api.login({ email, password });
      setToken(data.token);
      setUser(data.user);
      onLoginSuccess(data.user);
    } catch (err) {
      setError(err.message || 'Login failed. Please check credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="worker-container" style={{ padding: 'var(--spacing-4)' }}>
      <div className="card" style={{ margin: 'auto 0', padding: 'var(--spacing-5) var(--spacing-4)', boxShadow: 'var(--shadow-md)', width: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: 'var(--spacing-5)' }}>
          <h1 style={{ fontSize: 'clamp(1.35rem, 5vw, 1.75rem)', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '0.5px' }}>
            COLD PAYASAM
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9375rem', fontWeight: 500, marginTop: 'var(--spacing-1)' }}>
            Stall Management System
          </p>
        </div>

        {error && (
          <div className="status-pill status-pill-red" style={{ width: '100%', marginBottom: 'var(--spacing-4)', justifyContent: 'center', padding: '10px 14px', borderRadius: 'var(--radius-md)' }}>
            {error}
          </div>
        )}

        <form onSubmit={(e) => handleLogin(e)}>
          <div className="form-group">
            <label className="form-label" htmlFor="login-email">Email Address</label>
            <div style={{ position: 'relative' }}>
              <Mail size={20} strokeWidth={1.5} style={{ position: 'absolute', left: 14, top: 16, color: 'var(--text-muted)' }} />
              <input
                id="login-email"
                type="email"
                className="input-large"
                style={{ paddingLeft: 44 }}
                placeholder="worker@payasam.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="login-password">Password</label>
            <div style={{ position: 'relative' }}>
              <Lock size={20} strokeWidth={1.5} style={{ position: 'absolute', left: 14, top: 16, color: 'var(--text-muted)' }} />
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                className="input-large"
                style={{ paddingLeft: 44, paddingRight: 44 }}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword(!showPassword)}
                style={{ position: 'absolute', right: 12, top: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4 }}
              >
                {showPassword ? <EyeOff size={20} strokeWidth={1.5} /> : <Eye size={20} strokeWidth={1.5} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', minHeight: '52px', fontSize: '1.0625rem', marginTop: 'var(--spacing-2)' }}
            disabled={loading}
          >
            <LogIn size={20} strokeWidth={1.5} />
            <span>{loading ? 'Logging in...' : 'Sign In'}</span>
          </button>
        </form>


      </div>
    </div>
  );
}
