import React from 'react';
import { removeToken, removeUser, getUser } from '../api';

export default function Navbar({ onLogout }) {
  const user = getUser();

  const handleLogout = () => {
    removeToken();
    removeUser();
    if (onLogout) onLogout();
  };

  return (
    <header className="app-header">
      <div className="header-brand">
        <div>
          <div className="header-title">COLD PAYASAM</div>
          <div className="header-subtitle">
            {user?.role === 'ADMIN' ? 'Admin Dashboard' : 'Stall 1 Workspace'}
          </div>
        </div>
      </div>
      {user && (
        <div className="user-badge">
          <span>{user.name}</span>
          <button onClick={handleLogout} className="btn-logout" title="Logout">
            Logout
          </button>
        </div>
      )}
    </header>
  );
}
