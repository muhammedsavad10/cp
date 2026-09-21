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
  const [voidSaleId, setVoidSaleId] = useState(null);
  const [voidReason, setVoidReason] = useState('');
  const [reopenReason, setReopenReason] = useState('');
  const [showReopenModal, setShowReopenModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionSuccess, setActionSuccess] = useState('');
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

  const handleWSEvent = useCallback((data) => {
    if (data.type === 'STALL_ACTION' || data.type === 'STALL_STATUS_CHANGE') {
      fetchAllData();
    }
  }, [fetchAllData]);

  const { isConnected: isWSConnected } = useWebSocket(handleWSEvent);

  useEffect(() => {
    fetchAllData();
    const interval = setInterval(fetchAllData, 15000);
    return () => clearInterval(interval);
  }, [fetchAllData]);

  const handleDispatch = async (e) => {
    if (e) e.preventDefault();
    if (!dispatchQty || Number(dispatchQty) <= 0) return;

    try {
      setActionSuccess('');
      const res = await api.dispatchStock({ stall_id: 1, quantity: Number(dispatchQty) });
      setActionSuccess(res.message || `Successfully dispatched ${dispatchQty} glasses!`);
      setTimeout(() => setActionSuccess(''), 4000);
      fetchAllData();
    } catch (err) {
      setError(err.message || 'Dispatch failed');
    }
  };

  const handleVoidSale = async (e) => {
    e.preventDefault();
    if (!voidSaleId || !voidReason) return;

    try {
      setActionSuccess('');
      const res = await api.voidSale({ sale_id: voidSaleId, reason: voidReason });
      setActionSuccess(res.message || `Sale #${voidSaleId} voided.`);
      setVoidSaleId(null);
      setVoidReason('');
      setTimeout(() => setActionSuccess(''), 4000);
      fetchAllData();
    } catch (err) {
      setError(err.message || 'Void sale failed');
    }
  };

  const handleReopenDay = async (e) => {
    e.preventDefault();
    if (!reopenReason) return;

    try {
      setActionSuccess('');
      const today = dashboardData?.today;
      const res = await api.reopenDay({ stall_id: 1, business_date: today, reason: reopenReason });
      setActionSuccess(res.message || 'Day reopened successfully.');
      setShowReopenModal(false);
      setReopenReason('');
      setTimeout(() => setActionSuccess(''), 4000);
      fetchAllData();
    } catch (err) {
      setError(err.message || 'Reopen day failed');
    }
  };

  const handleBackup = () => {
    window.open('/api/admin/backup', '_blank');
  };

  const handleExportCSV = () => {
    const today = dashboardData?.today || new Date().toISOString().split('T')[0];
    window.open(`/api/admin/export.csv?from=${today}&to=${today}`, '_blank');
  };

  const formatTime = (isoStr) => {
    if (!isoStr) return '—';
    try {
      return new Date(isoStr).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (e) {
      return isoStr;
    }
  };

  const formatTimeShort = (isoStr) => {
    if (!isoStr) return '—';
    try {
      return new Date(isoStr).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return isoStr;
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
  const closing = dashboardData?.closing || null;

  return (
    <div className="app-container admin-container">
      <Navbar onLogout={onLogout} />

      {/* Admin Navigation Tabs & Action Controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'white', borderBottom: '1px solid var(--border-color)', paddingRight: 16 }}>
        <nav className="admin-tabs" style={{ borderBottom: 'none' }}>
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

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="btn-action"
            style={{ padding: '6px 12px', fontSize: '0.8rem', background: '#f1f5f9', color: '#1e293b' }}
            onClick={handleBackup}
          >
            💾 Backup DB
          </button>
          <button
            type="button"
            className="btn-action"
            style={{ padding: '6px 12px', fontSize: '0.8rem', background: '#e0e7ff', color: '#3730a3' }}
            onClick={handleExportCSV}
          >
            📥 Export CSV
          </button>
        </div>
      </div>

      <main className="main-content">
        {error && (
          <div className="badge badge-danger" style={{ width: '100%', padding: 10 }}>
            {error}
          </div>
        )}

        {actionSuccess && (
          <div className="badge badge-success" style={{ width: '100%', padding: 10 }}>
            {actionSuccess}
          </div>
        )}

        {/* 1. DASHBOARD VIEW */}
        {activeTab === 'dashboard' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ fontSize: '1.3rem', fontWeight: 900, color: '#0f172a' }}>PAYASAM ADMIN</h2>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                  TODAY &bull; {dashboardData?.today} (IST)
                </p>
              </div>
              <span className={`badge ${isWSConnected ? 'badge-success' : 'badge-warning'}`}>
                {isWSConnected ? '⚡ Real-time Sync Active' : '🔌 Polling Mode'}
              </span>
            </div>

            {/* Flags Alert */}
            {metrics.isOverSold && (
              <div className="badge badge-warning" style={{ width: '100%', padding: 10 }}>
                ⚠️ Flagged: Sold beyond recorded stock!
              </div>
            )}
            {metrics.isLargeWastage && (
              <div className="badge badge-danger" style={{ width: '100%', padding: 10 }}>
                🚨 Flagged: Total wastage is &gt; 10% of total stock received today!
              </div>
            )}

            {/* LIVE STALL STATUS CARD */}
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
                <span>Reversals today: <strong>{metrics.reversalsToday || 0}</strong></span>
              </div>
            </div>

            {/* TWO SEPARATE STATUSES: Stock Check & Money Check */}
            <div className="card" style={{ padding: 16 }}>
              <div className="card-title">Daily Closing Statuses</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ padding: 14, background: '#f8fafc', borderRadius: 12, border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Stock Check</div>
                  <div style={{ marginTop: 6 }}>
                    {closing ? (
                      closing.stock_status === 'MATCHED' ? (
                        <span className="badge badge-success" style={{ fontSize: '1rem' }}>🟢 MATCHED (₹0)</span>
                      ) : closing.stock_status === 'SHORT' ? (
                        <span className="badge badge-danger" style={{ fontSize: '1rem' }}>🔴 SHORT ({closing.stock_variance} glasses / ₹{Math.abs(closing.stock_variance_value)})</span>
                      ) : (
                        <span className="badge badge-warning" style={{ fontSize: '1rem' }}>🟠 EXTRA (+{closing.stock_variance} glasses / +₹{closing.stock_variance_value})</span>
                      )
                    ) : (
                      <span className="badge badge-warning">UNCLOSED</span>
                    )}
                  </div>
                </div>

                <div style={{ padding: 14, background: '#f8fafc', borderRadius: 12, border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Money Check</div>
                  <div style={{ marginTop: 6 }}>
                    {closing ? (
                      closing.money_status === 'MATCHED' ? (
                        <span className="badge badge-success" style={{ fontSize: '1rem' }}>🟢 MATCHED (₹0)</span>
                      ) : closing.money_status === 'SHORT' ? (
                        <span className="badge badge-danger" style={{ fontSize: '1rem' }}>🔴 SHORT (₹{Math.abs(closing.money_difference)})</span>
                      ) : (
                        <span className="badge badge-warning" style={{ fontSize: '1rem' }}>🟠 EXTRA (+₹{closing.money_difference})</span>
                      )
                    ) : (
                      <span className="badge badge-warning">UNCLOSED</span>
                    )}
                  </div>
                </div>
              </div>

              {closing && (
                <div style={{ marginTop: 12, textAlign: 'right' }}>
                  <button
                    type="button"
                    className="btn-action"
                    style={{ background: '#fee2e2', color: '#991b1b', fontSize: '0.85rem', padding: '6px 12px' }}
                    onClick={() => setShowReopenModal(true)}
                  >
                    🔓 Reopen Day
                  </button>
                </div>
              )}
            </div>

            {/* REAL-TIME ACTIVITY FEED */}
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
              {actionSuccess && <div className="badge badge-success" style={{ marginBottom: 10 }}>{actionSuccess}</div>}

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
                  DISPATCH
                </button>
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
                      <th>Dispatched Qty</th>
                      <th>Received Qty</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stockLog?.dispatches?.length > 0 ? (
                      stockLog.dispatches.map((d) => (
                        <tr key={d.id}>
                          <td>{formatTimeShort(d.created_at)}</td>
                          <td style={{ fontWeight: 800 }}>{d.quantity}</td>
                          <td style={{ fontWeight: 800 }}>{d.received_quantity !== null ? d.received_quantity : '—'}</td>
                          <td>
                            <span className={`badge ${d.status === 'RECEIVED' ? 'badge-success' : 'badge-warning'}`}>
                              {d.status}
                              {d.received_quantity !== null && d.received_quantity !== d.quantity && (
                                ` (${d.received_quantity < d.quantity ? 'SHORT' : 'MORE'})`
                              )}
                            </span>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="4" style={{ textAlign: 'center', color: '#94a3b8' }}>No stock dispatches today.</td>
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
                <p style={{ fontSize: '0.85rem', color: '#64748b' }}>Reversals today: {metrics.reversalsToday || 0}</p>
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
                      <th>ID</th>
                      <th>Time</th>
                      <th>Qty</th>
                      <th>Amount</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {salesLog?.sales?.length > 0 ? (
                      salesLog.sales.map((sale) => (
                        <tr key={sale.id} style={{ background: sale.quantity < 0 ? '#fee2e2' : 'inherit' }}>
                          <td>#{sale.id}</td>
                          <td>{formatTime(sale.created_at)}</td>
                          <td style={{ fontWeight: 800, color: sale.quantity < 0 ? '#dc2626' : '#10b981' }}>
                            {sale.quantity > 0 ? `+${sale.quantity}` : sale.quantity}
                          </td>
                          <td style={{ fontWeight: 800 }}>₹{sale.quantity * sale.selling_price}</td>
                          <td>
                            {sale.quantity > 0 && !salesLog.sales.some(s => s.reversal_of === sale.id) ? (
                              <button
                                type="button"
                                className="btn-action"
                                style={{ padding: '4px 8px', fontSize: '0.8rem', background: '#fee2e2', color: '#991b1b' }}
                                onClick={() => setVoidSaleId(sale.id)}
                              >
                                Void
                              </button>
                            ) : sale.quantity < 0 ? (
                              <span style={{ fontSize: '0.8rem', color: '#991b1b', fontWeight: 700 }}>
                                Reversal (#{sale.reversal_of})
                              </span>
                            ) : (
                              <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Voided</span>
                            )}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="5" style={{ textAlign: 'center', color: '#94a3b8' }}>No sales recorded today.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Void Sale Modal */}
            {voidSaleId && (
              <div className="modal-overlay" onClick={() => setVoidSaleId(null)}>
                <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                  <div className="modal-header">
                    <h3 className="modal-title">VOID SALE #{voidSaleId}</h3>
                    <button className="btn-close-modal" onClick={() => setVoidSaleId(null)}>&times;</button>
                  </div>
                  <form onSubmit={handleVoidSale}>
                    <div className="form-group">
                      <label className="form-label">Void Reason (Required)</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="e.g. Customer changed mind / accidental entry"
                        value={voidReason}
                        onChange={(e) => setVoidReason(e.target.value)}
                        required
                      />
                    </div>
                    <button type="submit" className="btn-submit" style={{ background: '#dc2626' }}>
                      CONFIRM VOID SALE
                    </button>
                  </form>
                </div>
              </div>
            )}
          </>
        )}

        {/* 5. MONEY VIEW */}
        {activeTab === 'money' && (
          <>
            <h2 style={{ fontSize: '1.3rem', fontWeight: 900 }}>MONEY & RECONCILIATION</h2>

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
                  <span style={{ fontWeight: 800 }}>Money Difference</span>
                  <span style={{ fontWeight: 900, fontSize: '1.2rem', color: moneyLog?.moneyDifference === 0 ? '#16a34a' : '#dc2626' }}>
                    {moneyLog?.moneyDifference !== null ? `₹${moneyLog?.moneyDifference}` : '—'}
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

      {/* Reopen Day Modal */}
      {showReopenModal && (
        <div className="modal-overlay" onClick={() => setShowReopenModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">REOPEN DAY</h3>
              <button className="btn-close-modal" onClick={() => setShowReopenModal(false)}>&times;</button>
            </div>
            <form onSubmit={handleReopenDay}>
              <div className="form-group">
                <label className="form-label">Reopen Reason (Required)</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Closing count error correction"
                  value={reopenReason}
                  onChange={(e) => setReopenReason(e.target.value)}
                  required
                />
              </div>
              <button type="submit" className="btn-submit" style={{ background: '#ea580c' }}>
                REOPEN DAY
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
