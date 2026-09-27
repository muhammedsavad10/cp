import React from 'react';
import { LogOut, User } from 'lucide-react';
import { removeToken, removeUser, getUser } from '../api';

export default function Navbar({ onLogout }) {
  const user = getUser();

  const handleLogout = () => {
    removeToken();
    removeUser();
    if (onLogout) onLogout();
  };

  return (
    <header className="top-bar">
      <div className="top-bar-title">
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>COLD PAYASAM</span>
        <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', fontWeight: 500, whiteSpace: 'nowrap', flexShrink: 0 }}>
          &bull; {user?.role === 'ADMIN' ? 'Admin' : 'Stall'}
        </span>
      </div>

      {user && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)', flexShrink: 0 }}>
          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <User size={16} strokeWidth={1.5} />
            { }
          </span>
          <button
            onClick={handleLogout}
            aria-label="Logout"
            className="btn btn-quiet"
            style={{ minHeight: '36px', height: '36px', padding: '0 10px', fontSize: '0.8125rem' }}
          >
            <LogOut size={16} strokeWidth={1.5} />
            <span>Logout</span>
          </button>
        </div>
      )}
    </header>
  );
}
