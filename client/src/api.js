const API_BASE = '/api';

export const getToken = () => localStorage.getItem('payasam_token');
export const setToken = (token) => localStorage.setItem('payasam_token', token);
export const removeToken = () => localStorage.removeItem('payasam_token');

export const getUser = () => {
  const u = localStorage.getItem('payasam_user');
  return u ? JSON.parse(u) : null;
};
export const setUser = (user) => localStorage.setItem('payasam_user', JSON.stringify(user));
export const removeUser = () => localStorage.removeItem('payasam_user');

const fetchAPI = async (endpoint, options = {}) => {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers
  };

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'API Request failed');
  }

  return data;
};

export const api = {
  login: (credentials) => fetchAPI('/auth/login', { method: 'POST', body: JSON.stringify(credentials) }),
  getMe: () => fetchAPI('/auth/me'),

  // Stall Worker
  getStallDashboard: () => fetchAPI('/stall/dashboard'),
  sellOne: () => fetchAPI('/stall/sell', { method: 'POST' }),
  confirmReceipt: (dispatch_id) => fetchAPI('/stall/confirm-receipt', { method: 'POST', body: JSON.stringify({ dispatch_id }) }),
  submitWastage: (payload) => fetchAPI('/stall/wastage', { method: 'POST', body: JSON.stringify(payload) }),
  closeDay: (payload) => fetchAPI('/stall/close-day', { method: 'POST', body: JSON.stringify(payload) }),

  // Admin
  getAdminDashboard: () => fetchAPI('/admin/dashboard'),
  dispatchStock: (payload) => fetchAPI('/admin/dispatch', { method: 'POST', body: JSON.stringify(payload) }),
  getSalesLog: () => fetchAPI('/admin/sales'),
  getStockLog: () => fetchAPI('/admin/stock'),
  getMoneyLog: () => fetchAPI('/admin/money'),
  getReports: () => fetchAPI('/admin/reports')
};
