import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { useWebSocket } from '../useWebSocket';
import Navbar from '../components/Navbar';

export default function AdminDashboard({ onLogout }) {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [dashboardData, setDashboardData] = useState(null);
  const [salesLog, setSalesLog] = useState(null);
  const [stockLog, setStockLog] = useState(null);
  const [moneyLog, setMoneyLog] = useState(null);
  const [reportsData, setReportsData] = useState(null);
  const [dispatchQty, setDispatchQty] = useState('50');
  const [loading, setLoading] = useState(true);
  const [dispatchSuccess, setDispatchSuccess] = useState('');
  const [error, setError] = useState('');

  const fetchAllData = useCallback(async () => {
    try {
      setError('');
      const [dash, sales, stock, money, reports] = await Promise.all([
        api.getAdminDashboard(),
        api.getSalesLog(),
        api.getStockLog(),
        api.getMoneyLog(),
        api.getReports()
      ]);
      setDashboardData(dash);
      setSalesLog(sales);
      setStockLog(stock);
      setMoneyLog(money);
      setReportsData(reports);
    } catch (err) {
      setError(err.message || 'Failed to fetch admin data');
    } finally {
      setLoading(false);
    }
  }, []);

  // Handle incoming real-time events via WebSockets!
  const handleWSEvent = useCallback((data) => {
    if (data.type === 'STALL_ACTION' || data.type === 'STALL_STATUS_CHANGE') {
      fetchAllData();
    }
  }, [fetchAllData]);

  // Connect WebSockets
  const { isConnected: isWSConnected } = useWebSocket(handleWSEvent);

  useEffect(() => {
    fetchAllData();
    const interval = setInterval(fetchAllData, 15000); // Polling backup
    return () => clearInterval(interval);
  }, [fetchAllData]);

  const handleDispatch = async (e) => {
    if (e) e.preventDefault();
    if (!dispatchQty || Number(dispatchQty) <= 0) return;

    try {
      setDispatchSuccess('');
      const res = await api.dispatchStock({ stall_id: 1, quantity: Number(dispatchQty) });
      setDispatchSuccess(res.message || `Successfully dispatched ${dispatchQty} glasses!`);
      setTimeout(() => setDispatchSuccess(''), 4000);
      fetchAllData();
    } catch (err) {
      setError(err.message || 'Dispatch failed');
    }
  };

  const formatTime = (timeStr) => {
    if (!timeStr) return '—';
    try {
      const d = new Date(timeStr);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (e) {
      return timeStr;
    }
  };

  const formatTimeShort = (timeStr) => {
    if (!timeStr) return '—';
    try {
      const d = new Date(timeStr);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return timeStr;
    }
  };

  if (loading) {
    return (
      <div className="app-container admin-container">
        <Navbar onLogout={onLogout} />
        <div className="main-content" style={{ textAlign: 'center', paddingTop: 40 }}>
          <p style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>Loading Admin Dashboard...</p>
        </div>
      </div>
    );
  }

  const metrics = dashboardData?.metrics || {};
  const stall1 = dashboardData?.stall1Status || {};

  return (
    <div className="app-container admin-container">
      <Navbar onLogout={onLogout} />

      {/* Admin Sub-navigation Tabs */}
      <nav className="admin-tabs">
        {['dashboard', 'stall', 'stock', 'sales', 'money', 'reports'].map((tab) => (
          <button
            key={tab}
            className={`tab-btn ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab.toUpperCase()}
          </button>
        ))}
      </nav>

      <main className="main-content">
        {error && (
          <div className="badge badge-danger" style={{ width: '100%', padding: 10 }}>
            {error}
          </div>
        )}

        {/* 1. DASHBOARD VIEW */}
        {activeTab === 'dashboard' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ fontSize: '1.3rem', fontWeight: 900, color: '#0f172a' }}>PAYASAM ADMIN</h2>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                  TODAY &bull; {dashboardData?.today}
                </p>
              </div>
              <span className={`badge ${isWSConnected ? 'badge-success' : 'badge-warning'}`}>
                {isWSConnected ? '⚡ Real-time Sync Active' : '🔌 Polling Mode'}
              </span>
            </div>

            {/* LIVE STALL STATUS CARD (Primary Requirement) */}
            <div className="card" style={{ background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)', border: '2px solid #cbd5e1' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div>
                  <h3 style={{ fontSize: '1.25rem', fontWeight: 900, color: '#0f172a' }}>STALL 1</h3>
                  <div style={{ marginTop: 2 }}>
                    {stall1.isOnline ? (
                      <span className="badge badge-success" style={{ fontSize: '0.9rem', padding: '4px 12px' }}>
                        🟢 Stall 1 Online
                      </span>
                    ) : (
                      <span className="badge badge-warning" style={{ fontSize: '0.9rem', padding: '4px 12px' }}>
                        🟠 Stall 1 Offline
                      </span>
                    )}
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>
                    {stall1.isOnline ? 'Last Activity' : 'Last Synced'}
                  </div>
                  <div style={{ fontWeight: 800, fontSize: '0.95rem', color: '#1e293b' }}>
                    {formatTimeShort(stall1.lastSaleTime || stall1.lastSeen)}
                  </div>
                </div>
              </div>

              {/* Live Stall Metrics Grid */}
              <div className="stock-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 10 }}>
                <div className="stock-item">
                  <div className="stock-label">Received</div>
                  <div className="stock-value">{stall1.received || 0}</div>
                </div>
                <div className="stock-item">
                  <div className="stock-label">Sold</div>
                  <div className="stock-value" style={{ color: '#059669' }}>{stall1.sold || 0}</div>
                </div>
                <div className="stock-item">
                  <div className="stock-label">Wastage</div>
                  <div className="stock-value" style={{ color: '#dc2626' }}>{stall1.wastage || 0}</div>
                </div>
                <div className="stock-item">
                  <div className="stock-label">Expected Rem.</div>
                  <div className="stock-value expected">{stall1.expectedRemaining || 0}</div>
                </div>
                <div className="stock-item">
                  <div className="stock-label">Revenue</div>
                  <div className="stock-value" style={{ color: '#047857' }}>₹{(stall1.revenue || 0).toLocaleString()}</div>
                </div>
              </div>

              <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#64748b', fontWeight: 600 }}>
                <span>Last transaction: <strong>{formatTime(stall1.lastSaleTime)}</strong></span>
                <span>Status: <strong style={{ color: '#16a34a' }}>🟢 LIVE</strong></span>
              </div>
            </div>

            {/* Overview Stats Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
              <div className="card" style={{ padding: 14 }}>
                <div className="card-title" style={{ fontSize: '0.75rem' }}>Sales</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--primary)' }}>
                  {metrics.totalSold} <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>glasses</span>
                </div>
              </div>

              <div className="card" style={{ padding: 14 }}>
                <div className="card-title" style={{ fontSize: '0.75rem' }}>Revenue</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#047857' }}>
                  ₹{(metrics.totalRevenue || 0).toLocaleString()}
                </div>
              </div>

              <div className="card" style={{ padding: 14 }}>
                <div className="card-title" style={{ fontSize: '0.75rem' }}>Stock Received</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>
                  {metrics.totalStockReceived}
                </div>
              </div>

              <div className="card" style={{ padding: 14 }}>
                <div className="card-title" style={{ fontSize: '0.75rem' }}>Expected Remaining</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#2563eb' }}>
                  {metrics.expectedRemaining}
                </div>
              </div>
            </div>

            {/* Money Reconciliation Card */}
            <div className="card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div className="card-title" style={{ margin: 0 }}>Cash & UPI Reconciliation</div>
                {moneyLog?.isClosed ? (
                  moneyLog?.isMatched ? (
                    <span className="badge badge-success">🟢 MATCHED</span>
                  ) : (
                    <span className="badge badge-danger">🔴 DISCREPANCY</span>
                  )
                ) : (
                  <span className="badge badge-warning">🟠 UNCLOSED</span>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10, textAlign: 'center' }}>
                <div className="stock-item">
                  <div className="stock-label">Expected</div>
                  <div className="stock-value">₹{(metrics.totalRevenue || 0).toLocaleString()}</div>
                </div>
                <div className="stock-item">
                  <div className="stock-label">Cash</div>
                  <div className="stock-value">₹{metrics.cashReceived !== null ? metrics.cashReceived : '—'}</div>
                </div>
                <div className="stock-item">
                  <div className="stock-label">UPI</div>
                  <div className="stock-value">₹{metrics.upiReceived !== null ? metrics.upiReceived : '—'}</div>
                </div>
                <div className="stock-item">
                  <div className="stock-label">Discrepancy</div>
                  <div className="stock-value" style={{ color: metrics.discrepancy === 0 ? '#16a34a' : '#dc2626' }}>
                    {metrics.discrepancy !== null ? `₹${metrics.discrepancy}` : '—'}
                  </div>
                </div>
              </div>
            </div>

            {/* LIVE ACTIVITY FEED */}
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div className="card-title" style={{ margin: 0 }}>REAL-TIME ACTIVITY FEED</div>
                <span className="badge badge-success" style={{ fontSize: '0.75rem' }}>Live stream</span>
              </div>

              {dashboardData?.recentActivity?.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {dashboardData.recentActivity.map((act) => (
                    <div
                      key={`${act.type}-${act.id}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justify: 'space-between',
                        padding: '10px 14px',
                        background: '#f8fafc',
                        borderRadius: 10,
                        borderLeft: act.type === 'SALE' ? '4px solid #10b981' : act.type === 'RECEIPT' ? '4px solid #f59e0b' : '4px solid #6366f1'
                      }}
                    >
                      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#64748b', minWidth: 65 }}>
                          {formatTimeShort(act.created_at)}
                        </span>
                        <span style={{ fontWeight: 700, fontSize: '0.95rem', color: '#1e293b' }}>
                          — {act.description}
                        </span>
                      </div>
                      <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#94a3b8' }}>
                        {act.type}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No activity recorded today yet.</p>
              )}
            </div>
          </>
        )}

        {/* 2. STALL VIEW */}
        {activeTab === 'stall' && (
          <>
            <h2 style={{ fontSize: '1.3rem', fontWeight: 900 }}>STALL MANAGEMENT</h2>
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <div>
                  <h3 style={{ fontSize: '1.2rem', fontWeight: 800 }}>Stall 1 (Main Stall)</h3>
                  <p style={{ fontSize: '0.85rem', color: '#64748b' }}>Status: Operating</p>
                </div>
                {stall1.isOnline ? (
                  <span className="badge badge-success">🟢 Stall 1 Online</span>
                ) : (
                  <span className="badge badge-warning">🟠 Stall 1 Offline</span>
                )}
              </div>

              <div className="stock-grid" style={{ marginBottom: 16 }}>
                <div className="stock-item">
                  <div className="stock-label">Stock Received</div>
                  <div className="stock-value">{metrics.totalStockReceived}</div>
                </div>
                <div className="stock-item">
                  <div className="stock-label">Sold</div>
                  <div className="stock-value">{metrics.totalSold}</div>
                </div>
                <div className="stock-item">
                  <div className="stock-label">Wastage</div>
                  <div className="stock-value">{metrics.totalWastage}</div>
                </div>
                <div className="stock-item">
                  <div className="stock-label">Expected Remaining</div>
                  <div className="stock-value expected">{metrics.expectedRemaining}</div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* 3. STOCK VIEW */}
        {activeTab === 'stock' && (
          <>
            <h2 style={{ fontSize: '1.3rem', fontWeight: 900 }}>STOCK DISPATCH & AUDIT</h2>

            {/* Quick Dispatch Card */}
            <div className="card" style={{ background: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)', border: '1px solid #86efac' }}>
              <div className="card-title" style={{ color: '#166534' }}>Today's Dispatch to Stall 1</div>
              {dispatchSuccess && <div className="badge badge-success" style={{ marginBottom: 10 }}>{dispatchSuccess}</div>}

              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                  <label className="form-label" style={{ marginBottom: 4 }}>Quantity (Glasses)</label>
                  <input
                    type="number"
                    className="form-input"
                    value={dispatchQty}
                    onChange={(e) => setDispatchQty(e.target.value)}
                  />
                </div>
                <button
                  className="btn-submit"
                  style={{ width: 'auto', padding: '14px 24px', marginTop: 18 }}
                  onClick={handleDispatch}
                >
                  DISPATCH 50
                </button>
              </div>
            </div>

            {/* Stock Breakdown */}
            <div className="card">
              <div className="card-title">Stock Summary</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10, textAlign: 'center' }}>
                <div className="stock-item">
                  <div className="stock-label">Product</div>
                  <div style={{ fontWeight: 800, fontSize: '0.95rem', marginTop: 4 }}>Butter Fruit</div>
                </div>
                <div className="stock-item">
                  <div className="stock-label">Received</div>
                  <div className="stock-value">{stockLog?.totalReceived || 0}</div>
                </div>
                <div className="stock-item">
                  <div className="stock-label">Sold</div>
                  <div className="stock-value">{stockLog?.totalSold || 0}</div>
                </div>
                <div className="stock-item">
                  <div className="stock-label">Wastage</div>
                  <div className="stock-value">{stockLog?.totalWastage || 0}</div>
                </div>
                <div className="stock-item">
                  <div className="stock-label">Expected</div>
                  <div className="stock-value expected">{stockLog?.expectedRemaining || 0}</div>
                </div>
                <div className="stock-item">
                  <div className="stock-label">Actual</div>
                  <div className="stock-value">{stockLog?.actualRemaining !== null ? stockLog?.actualRemaining : '—'}</div>
                </div>
              </div>
            </div>

            {/* Dispatch History Table */}
            <div className="card">
              <div className="card-title">Stock Dispatch Log</div>
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Qty</th>
                      <th>Dispatched By</th>
                      <th>Received By</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stockLog?.dispatches?.length > 0 ? (
                      stockLog.dispatches.map((d) => (
                        <tr key={d.id}>
                          <td>{formatTimeShort(d.created_at)}</td>
                          <td style={{ fontWeight: 800 }}>{d.quantity}</td>
                          <td>{d.dispatched_by_name || 'Admin'}</td>
                          <td>{d.received_by_name || '—'}</td>
                          <td>
                            <span className={`badge ${d.status === 'RECEIVED' ? 'badge-success' : 'badge-warning'}`}>
                              {d.status}
                            </span>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="5" style={{ textAlign: 'center', color: '#94a3b8' }}>No stock dispatches today.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* 4. SALES VIEW */}
        {activeTab === 'sales' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ fontSize: '1.3rem', fontWeight: 900 }}>TODAY'S SALES LOG</h2>
                <p style={{ fontSize: '0.85rem', color: '#64748b' }}>Append-Only Real-Time Sales Audit</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Total Revenue</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 900, color: '#059669' }}>
                  ₹{(salesLog?.totalRevenue || 0).toLocaleString()}
                </div>
              </div>
            </div>

            <div className="card">
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Product</th>
                      <th>Qty</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {salesLog?.sales?.length > 0 ? (
                      salesLog.sales.map((sale) => (
                        <tr key={sale.id}>
                          <td>{formatTime(sale.created_at)}</td>
                          <td style={{ fontWeight: 700 }}>{sale.product_name}</td>
                          <td style={{ fontWeight: 800 }}>{sale.quantity}</td>
                          <td style={{ fontWeight: 800, color: '#059669' }}>₹{sale.quantity * sale.selling_price}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="4" style={{ textAlign: 'center', color: '#94a3b8' }}>No sales recorded today.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* 5. MONEY VIEW */}
        {activeTab === 'money' && (
          <>
            <h2 style={{ fontSize: '1.3rem', fontWeight: 900 }}>MONEY & CASH RECONCILIATION</h2>

            <div className="card" style={{ textAlign: 'center', padding: 24 }}>
              <div className="card-title">Match Status</div>
              {moneyLog?.isClosed ? (
                moneyLog?.isMatched ? (
                  <div className="badge badge-success" style={{ fontSize: '1.4rem', padding: '10px 24px' }}>
                    🟢 MATCHED
                  </div>
                ) : (
                  <div className="badge badge-danger" style={{ fontSize: '1.4rem', padding: '10px 24px' }}>
                    🔴 DISCREPANCY
                  </div>
                )
              ) : (
                <div className="badge badge-warning" style={{ fontSize: '1.2rem', padding: '8px 20px' }}>
                  🟠 UNCLOSED DAY
                </div>
              )}
            </div>

            <div className="card">
              <div className="card-title">Financial Breakdown</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
                  <span style={{ fontWeight: 600, color: '#64748b' }}>Expected Revenue</span>
                  <span style={{ fontWeight: 800, fontSize: '1.1rem' }}>₹{(moneyLog?.expectedRevenue || 0).toLocaleString()}</span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
                  <span style={{ fontWeight: 600, color: '#64748b' }}>Cash Collected</span>
                  <span style={{ fontWeight: 800, fontSize: '1.1rem' }}>₹{(moneyLog?.cash || 0).toLocaleString()}</span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
                  <span style={{ fontWeight: 600, color: '#64748b' }}>UPI Collected</span>
                  <span style={{ fontWeight: 800, fontSize: '1.1rem' }}>₹{(moneyLog?.upi || 0).toLocaleString()}</span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '2px solid #e2e8f0' }}>
                  <span style={{ fontWeight: 800, fontSize: '1.1rem' }}>Total Received</span>
                  <span style={{ fontWeight: 900, fontSize: '1.2rem', color: '#059669' }}>₹{(moneyLog?.totalReceived || 0).toLocaleString()}</span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0' }}>
                  <span style={{ fontWeight: 800 }}>Discrepancy / Difference</span>
                  <span style={{ fontWeight: 900, fontSize: '1.2rem', color: moneyLog?.discrepancy === 0 ? '#16a34a' : '#dc2626' }}>
                    {moneyLog?.discrepancy !== null ? `₹${moneyLog?.discrepancy}` : '—'}
                  </span>
                </div>
              </div>
            </div>
          </>
        )}

        {/* 6. REPORTS VIEW */}
        {activeTab === 'reports' && (
          <>
            <h2 style={{ fontSize: '1.3rem', fontWeight: 900 }}>DAILY FINANCIAL REPORT</h2>

            <div className="card" style={{ background: '#f8fafc' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div>
                  <h3 style={{ fontSize: '1.2rem', fontWeight: 800 }}>Stall 1 P&L Report</h3>
                  <p style={{ fontSize: '0.85rem', color: '#64748b' }}>Date: {reportsData?.date}</p>
                </div>
                <span className="badge badge-success">MVP Single-Stall</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #e2e8f0' }}>
                  <span style={{ fontWeight: 600 }}>Total Glasses Sold</span>
                  <span style={{ fontWeight: 800, fontSize: '1.1rem' }}>{reportsData?.totalGlassesSold || 0}</span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #e2e8f0' }}>
                  <span style={{ fontWeight: 600 }}>Total Revenue (₹{reportsData?.sellingPrice || 40}/glass)</span>
                  <span style={{ fontWeight: 800, fontSize: '1.1rem', color: '#059669' }}>
                    ₹{(reportsData?.totalRevenue || 0).toLocaleString()}
                  </span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #e2e8f0' }}>
                  <span style={{ fontWeight: 600 }}>Direct Product Cost (₹{reportsData?.directCost || 20}/glass)</span>
                  <span style={{ fontWeight: 800, fontSize: '1.1rem', color: '#dc2626' }}>
                    - ₹{(reportsData?.totalProductCost || 0).toLocaleString()}
                  </span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #e2e8f0' }}>
                  <span style={{ fontWeight: 600 }}>Staff Cost</span>
                  <span style={{ fontWeight: 800, fontSize: '1.1rem', color: '#64748b' }}>
                    ₹{(reportsData?.staffCost || 0).toLocaleString()}
                  </span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 0', background: '#ffffff', borderRadius: 8, paddingLeft: 12, paddingRight: 12, border: '2px solid #bbf7d0' }}>
                  <span style={{ fontWeight: 900, fontSize: '1.1rem', color: '#065f46' }}>Estimated Operating Profit</span>
                  <span style={{ fontWeight: 900, fontSize: '1.3rem', color: '#059669' }}>
                    ₹{(reportsData?.estimatedOperatingProfit || 0).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
