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

  if (response.status === 401) {
    removeToken();
    removeUser();
  }

  const data = await response.json();
  if (!response.ok) {
    const err = new Error(data.error || 'API Request failed');
    err.status = response.status;
    err.data = data;
    throw err;
  }

  return data;
};

export const api = {
  login: (credentials) => fetchAPI('/auth/login', { method: 'POST', body: JSON.stringify(credentials) }),
  getMe: () => fetchAPI('/auth/me'),

  // Stall Worker
  getStallDashboard: () => fetchAPI('/stall/dashboard'),
  startDay: () => fetchAPI('/stall/start-day', { method: 'POST' }),
  sellOne: (idempotency_key) => fetchAPI('/stall/sell', { method: 'POST', body: JSON.stringify({ idempotency_key }) }),
  sellParcel: (idempotency_key) => fetchAPI('/stall/sell-parcel', { method: 'POST', body: JSON.stringify({ idempotency_key }) }),
  confirmReceipt: (dispatch_id, received_quantity) => fetchAPI('/stall/confirm-receipt', { method: 'POST', body: JSON.stringify({ dispatch_id, received_quantity }) }),
  undoLastSale: () => fetchAPI('/stall/undo-last', { method: 'POST' }),
  submitWastage: (payload) => fetchAPI('/stall/wastage', { method: 'POST', body: JSON.stringify(payload) }),
  closeDay: (payload) => fetchAPI('/stall/close-day', { method: 'POST', body: JSON.stringify(payload) }),

  // Admin
  getAdminDashboard: () => fetchAPI('/admin/dashboard'),
  dispatchStock: (payload) => fetchAPI('/admin/dispatch', { method: 'POST', body: JSON.stringify(payload) }),
  voidSale: (payload) => fetchAPI('/admin/void-sale', { method: 'POST', body: JSON.stringify(payload) }),
  reopenDay: (payload) => fetchAPI('/admin/reopen-day', { method: 'POST', body: JSON.stringify(payload) }),
  getSalesLog: () => fetchAPI('/admin/sales'),
  getStockLog: () => fetchAPI('/admin/stock'),
  getMoneyLog: () => fetchAPI('/admin/money'),
  getReports: () => fetchAPI('/admin/reports')
};
