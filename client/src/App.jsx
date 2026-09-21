import React, { useState, useEffect } from 'react';
import { getUser, getToken, api, removeToken, removeUser } from './api';
import Login from './pages/Login';
import StallDashboard from './pages/StallDashboard';
import AdminDashboard from './pages/AdminDashboard';

export default function App() {
  const [user, setUserState] = useState(getUser());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getToken();
    if (token) {
      api.getMe()
        .then((res) => {
          setUserState(res.user);
        })
        .catch(() => {
          removeToken();
          removeUser();
          setUserState(null);
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const handleLoginSuccess = (userData) => {
    setUserState(userData);
  };

  const handleLogout = () => {
    setUserState(null);
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif' }}>
        <h3>Loading Cold Payasam System...</h3>
      </div>
    );
  }

  if (!user) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  if (user.role === 'ADMIN') {
    return <AdminDashboard onLogout={handleLogout} />;
  }

  return <StallDashboard onLogout={handleLogout} />;
}
