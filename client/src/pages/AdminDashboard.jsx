import React, { useState, useEffect, useCallback } from 'react';
import {
  LayoutDashboard,
  Store,
  Package,
  ShoppingCart,
  IndianRupee,
  BarChart3,
  Download,
  Database,
  AlertTriangle,
  CheckCircle,
  Clock,
  X,
  Unlock,
  WifiOff,
  RotateCcw,
  Check,
  Trash2,
  CalendarCheck
} from 'lucide-react';
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
  const [lastUpdated, setLastUpdated] = useState(0);

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
      setLastUpdated(0);
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

  // Relative "Updated Ns ago" timer
  useEffect(() => {
    const timer = setInterval(() => {
      setLastUpdated(prev => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

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

  const handleBackup = () => window.open('/api/admin/backup', '_blank');
  const handleExportCSV = () => {
    const today = dashboardData?.today || new Date().toISOString().split('T')[0];
    window.open(`/api/admin/export.csv?from=${today}&to=${today}`, '_blank');
  };

  const formatTime = (isoStr) => {
    if (!isoStr) return '—';
    try {
      return new Date(isoStr).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (e) { return isoStr; }
  };

  const formatTimeShort = (isoStr) => {
    if (!isoStr) return '—';
    try {
      return new Date(isoStr).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return isoStr; }
  };

  if (loading) {
    return (
      <div className="app-shell">
        <Navbar onLogout={onLogout} />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Loading Admin Portal...</p>
        </div>
      </div>
    );
  }

  const metrics = dashboardData?.metrics || {};
  const stall1 = dashboardData?.stall1Status || {};
  const closing = dashboardData?.closing || null;

  const NAV_ITEMS = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'stall', label: 'Stall', icon: Store },
    { id: 'stock', label: 'Stock', icon: Package },
    { id: 'sales', label: 'Sales', icon: ShoppingCart },
    { id: 'money', label: 'Money', icon: IndianRupee },
    { id: 'reports', label: 'Reports', icon: BarChart3 }
  ];

  return (
    <div className="app-shell">
      <Navbar onLogout={onLogout} />

      <div className="admin-layout">
        {/* Desktop Sidebar (>=1024px) */}
        <aside className="admin-sidebar">
          <div style={{ marginBottom: 'var(--spacing-6)' }}>
            <h2 style={{ fontSize: '1.125rem', fontWeight: 800 }}>Admin Portal</h2>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>Cold Payasam MVP</p>
          </div>

          <nav style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-1)', flex: 1 }}>
            {NAV_ITEMS.map((item) => {
              const IconComp = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  className={`btn ${isActive ? 'btn-primary' : 'btn-quiet'}`}
                  style={{ justifyContent: 'flex-start', minHeight: '44px' }}
                  onClick={() => setActiveTab(item.id)}
                >
                  <IconComp size={18} strokeWidth={1.5} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2)', paddingTop: 'var(--spacing-4)', borderTop: '1px solid var(--border-subtle)' }}>
            <button type="button" className="btn btn-secondary" style={{ fontSize: '0.8125rem', minHeight: '40px' }} onClick={handleBackup}>
              <Database size={16} strokeWidth={1.5} />
              <span>Backup DB</span>
            </button>
            <button type="button" className="btn btn-secondary" style={{ fontSize: '0.8125rem', minHeight: '40px' }} onClick={handleExportCSV}>
              <Download size={16} strokeWidth={1.5} />
              <span>Export CSV</span>
            </button>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="admin-content">
          {/* Connection Lost Banner */}
          {!isWSConnected && (
            <div className="card" style={{ backgroundColor: 'var(--status-red-bg)', borderLeft: '4px solid var(--status-red)', color: 'var(--status-red)', padding: 'var(--spacing-3)', marginBottom: 'var(--spacing-4)', display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)' }}>
              <WifiOff size={20} strokeWidth={1.5} />
              <span style={{ fontSize: '0.9375rem', fontWeight: 600 }}>
                Connection lost. Numbers may be out of date.
              </span>
            </div>
          )}

          {error && (
            <div className="status-pill status-pill-red" style={{ width: '100%', marginBottom: 'var(--spacing-4)', padding: '10px' }}>
              {error}
            </div>
          )}

          {actionSuccess && (
            <div className="status-pill status-pill-green" style={{ width: '100%', marginBottom: 'var(--spacing-4)', padding: '10px' }}>
              {actionSuccess}
            </div>
          )}

          {/* 1. DASHBOARD VIEW */}
          {activeTab === 'dashboard' && (
            <div>
              {/* Header with Stall Name, Status Pill & Relative Time */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-4)', flexWrap: 'wrap', gap: 'var(--spacing-2)' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)' }}>
                    <h1 style={{ fontSize: '1.5rem', fontWeight: 800 }}>Stall 1</h1>
                    <span className={`status-pill ${stall1.status === 'LIVE' ? 'status-pill-green' : 'status-pill-amber'}`}>
                      {stall1.status === 'LIVE' ? 'Live' : stall1.status === 'CLOSED' ? 'Closed' : stall1.status === 'NOT_STARTED' ? 'Not started' : 'Offline'}
                    </span>
                  </div>
                  <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                    Today &bull; {dashboardData?.today} (IST)
                  </p>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                  <span className={`status-pill ${stall1.status === 'LIVE' ? 'status-pill-green' : 'status-pill-amber'}`}>
                    {stall1.status === 'LIVE' ? 'Live' : stall1.status === 'CLOSED' ? 'Closed' : stall1.status === 'NOT_STARTED' ? 'Not started' : 'Offline'}
                  </span>
                  <span className="num">Updated {lastUpdated}s ago</span>
                </div>
              </div>

              {/* KPI Cards Grid - Exactly 3 Rows (2 Columns each) */}
              <div className="kpi-grid" style={{ opacity: isWSConnected ? 1 : 0.6 }}>
                {/* Row 1 */}
                <div className="kpi-card">
                  <div className="kpi-label">Dispatched</div>
                  <div className="kpi-val num">{stall1.received || 0}</div>
                </div>

                <div className="kpi-card">
                  <div className="kpi-label">Sold</div>
                  <div className="kpi-val num">{stall1.sold || 0}</div>
                  <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: '4px' }} className="num">
                    {(stall1.received || 0) - (stall1.sold || 0)} items remaining
                  </div>
                </div>

                {/* Row 2 */}
                <div className="kpi-card">
                  <div className="kpi-label">Cash collected</div>
                  <div className="kpi-val num">
                    {closing ? `₹${(closing.cash_received || 0).toLocaleString('en-IN')}` : '—'}
                  </div>
                </div>

                <div className="kpi-card">
                  <div className="kpi-label">UPI collected</div>
                  <div className="kpi-val num">
                    {closing ? `₹${(closing.upi_received || 0).toLocaleString('en-IN')}` : '—'}
                  </div>
                </div>

                {/* Row 3 */}
                <div className="kpi-card">
                  <div className="kpi-label">Total Sales</div>
                  <div className="kpi-val num">{stall1.sold || 0}</div>
                </div>

                <div className="kpi-card">
                  <div className="kpi-label">Revenue</div>
                  <div className="kpi-val num">
                    {closing ? `₹${(stall1.revenue || 0).toLocaleString('en-IN')}` : '—'}
                  </div>
                </div>
              </div>

              {/* Check Cards: Stock Check & Money Check */}
              <div className="card" style={{ padding: 'var(--spacing-4)' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: 'var(--spacing-3)' }}>Closing Reconciliations</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--spacing-3)' }}>
                  {/* Stock Check */}
                  <div style={{ padding: 'var(--spacing-3)', backgroundColor: 'var(--bg-main)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Stock Check</div>
                    <div style={{ marginTop: 'var(--spacing-2)' }}>
                      {closing ? (
                        closing.stock_status === 'MATCHED' ? (
                          <span className="status-pill status-pill-green">
                            <Check size={14} strokeWidth={2} />
                            <span>MATCHED (0 glasses)</span>
                          </span>
                        ) : closing.stock_status === 'SHORT' ? (
                          <span className="status-pill status-pill-red">
                            <AlertTriangle size={14} strokeWidth={2} />
                            <span>SHORT ({closing.stock_variance} glasses / ₹{Math.abs(closing.stock_variance_value)})</span>
                          </span>
                        ) : (
                          <span className="status-pill status-pill-amber">
                            <AlertTriangle size={14} strokeWidth={2} />
                            <span>EXTRA (+{closing.stock_variance} glasses / +₹{closing.stock_variance_value})</span>
                          </span>
                        )
                      ) : (
                        <span className="status-pill status-pill-amber">UNCLOSED</span>
                      )}
                    </div>
                  </div>

                  {/* Money Check */}
                  <div style={{ padding: 'var(--spacing-3)', backgroundColor: 'var(--bg-main)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Money Check</div>
                    <div style={{ marginTop: 'var(--spacing-2)' }}>
                      {closing ? (
                        closing.money_status === 'MATCHED' ? (
                          <span className="status-pill status-pill-green">
                            <Check size={14} strokeWidth={2} />
                            <span>MATCHED (₹0)</span>
                          </span>
                        ) : closing.money_status === 'SHORT' ? (
                          <span className="status-pill status-pill-red">
                            <AlertTriangle size={14} strokeWidth={2} />
                            <span>SHORT (₹{Math.abs(closing.money_difference)})</span>
                          </span>
                        ) : (
                          <span className="status-pill status-pill-amber">
                            <AlertTriangle size={14} strokeWidth={2} />
                            <span>EXTRA (+₹{closing.money_difference})</span>
                          </span>
                        )
                      ) : (
                        <span className="status-pill status-pill-amber">UNCLOSED</span>
                      )}
                    </div>
                  </div>
                </div>

                {closing && (
                  <div style={{ marginTop: 'var(--spacing-4)', textAlign: 'right' }}>
                    <button
                      type="button"
                      className="btn btn-quiet"
                      style={{ color: 'var(--status-red)', fontSize: '0.875rem' }}
                      onClick={() => setShowReopenModal(true)}
                    >
                      <Unlock size={16} strokeWidth={1.5} />
                      <span>Reopen Day</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Real-Time Activity Feed */}
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-3)' }}>
                  <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>Activity Stream</h3>
                  <span className="status-pill status-pill-green">Live</span>
                </div>

                {dashboardData?.recentActivity?.length > 0 ? (
                  <div>
                    {dashboardData.recentActivity.map((act) => {
                      let IconComponent = ShoppingCart;
                      if (act.type === 'REVERSAL') IconComponent = RotateCcw;
                      if (act.type === 'DISPATCH') IconComponent = Package;
                      if (act.type === 'RECEIPT') IconComponent = Check;
                      if (act.type === 'WASTAGE') IconComponent = Trash2;
                      if (act.type === 'DAY_CLOSED') IconComponent = CalendarCheck;

                      return (
                        <div key={`${act.type}-${act.id}`} className="activity-item">
                          <div className="activity-icon">
                            <IconComponent size={18} strokeWidth={1.5} />
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '0.9375rem', fontWeight: 600 }}>{act.description}</div>
                            <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                              {formatTime(act.created_at)} (IST)
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No activity recorded today yet.</p>
                )}
              </div>
            </div>
          )}

          {/* 2. STALL VIEW */}
          {activeTab === 'stall' && (
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-4)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)' }}>
                  <h2 style={{ fontSize: '1.25rem', fontWeight: 800 }}>Stall 1</h2>
                  <span className={`status-pill ${stall1.status === 'LIVE' ? 'status-pill-green' : 'status-pill-amber'}`}>
                    {stall1.status === 'LIVE' ? 'Live' : stall1.status === 'CLOSED' ? 'Closed' : stall1.status === 'NOT_STARTED' ? 'Not started' : 'Offline'}
                  </span>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--spacing-3)', marginBottom: 'var(--spacing-4)' }}>
                <div style={{ padding: 'var(--spacing-3)', backgroundColor: 'var(--bg-main)', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>Day Started Time (IST)</div>
                  <div style={{ fontWeight: 700, marginTop: '2px' }} className="num">{stall1.started_at ? formatTime(stall1.started_at) : 'Not started'}</div>
                </div>

                <div style={{ padding: 'var(--spacing-3)', backgroundColor: 'var(--bg-main)', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>Day Closed Time (IST)</div>
                  <div style={{ fontWeight: 700, marginTop: '2px' }} className="num">{stall1.closed_at ? formatTime(stall1.closed_at) : 'Not closed'}</div>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2)', fontSize: '0.9375rem' }}>
                <div>Stock Received: <strong className="num">{metrics.totalStockReceived || 0}</strong> glasses</div>
                <div>Sold Today: <strong className="num">{metrics.totalSold || 0}</strong> glasses</div>
                <div>Wastage Today: <strong className="num">{metrics.totalWastage || 0}</strong> glasses</div>
                <div>Expected Remaining: <strong className="num">{metrics.expectedRemaining || 0}</strong> glasses</div>
              </div>
            </div>
          )}

          {/* 3. STOCK VIEW */}
          {activeTab === 'stock' && (
            <div>
              <div className="card" style={{ borderLeft: '4px solid var(--brand-accent)' }}>
                <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: 'var(--spacing-3)' }}>Dispatch Stock to Stall 1</h3>
                <form onSubmit={handleDispatch} style={{ display: 'flex', gap: 'var(--spacing-2)', alignItems: 'flex-end' }}>
                  <div style={{ flex: 1 }}>
                    <label className="form-label" htmlFor="dispatch-qty">Quantity (Glasses)</label>
                    <input
                      id="dispatch-qty"
                      type="number"
                      inputMode="numeric"
                      className="input-large num"
                      value={dispatchQty}
                      onChange={(e) => setDispatchQty(e.target.value)}
                      required
                    />
                  </div>
                  <button type="submit" className="btn btn-primary" style={{ minHeight: '52px' }}>
                    Dispatch Stock
                  </button>
                </form>
              </div>

              {/* Stock Dispatches Log Cards / Table */}
              <div className="card">
                <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: 'var(--spacing-3)' }}>Today's Dispatches</h3>
                {stockLog?.dispatches?.length > 0 ? (
                  <div>
                    {stockLog.dispatches.map((d) => (
                      <div key={d.id} className="activity-item" style={{ justifyContent: 'space-between' }}>
                        <div>
                          <div style={{ fontWeight: 700 }}>Dispatch #{d.id} &bull; {d.quantity} glasses</div>
                          <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{formatTimeShort(d.created_at)}</div>
                        </div>
                        <span className={`status-pill ${d.status === 'RECEIVED' ? 'status-pill-green' : 'status-pill-amber'}`}>
                          {d.status} {d.received_quantity !== null ? `(${d.received_quantity} recd)` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No stock dispatches today.</p>
                )}
              </div>
            </div>
          )}

          {/* 4. SALES VIEW */}
          {activeTab === 'sales' && (
            <div>
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-4)' }}>
                  <h3 style={{ fontSize: '1.125rem', fontWeight: 800 }}>Sales Log</h3>
                  <div className="num" style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--status-green)' }}>
                    Total: ₹{(salesLog?.totalRevenue || 0).toLocaleString('en-IN')}
                  </div>
                </div>

                {salesLog?.sales?.length > 0 ? (
                  <div>
                    {salesLog.sales.map((s) => (
                      <div key={s.id} className="activity-item" style={{ justifyContent: 'space-between', opacity: s.quantity < 0 ? 0.7 : 1 }}>
                        <div>
                          <div style={{ fontWeight: 700 }}>
                            {s.quantity > 0 ? `Sale #${s.id}` : `Reversal for #${s.reversal_of}`} &bull; ₹{s.quantity * s.selling_price}
                          </div>
                          <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{formatTime(s.created_at)}</div>
                        </div>
                        <div>
                          {s.quantity > 0 && !salesLog.sales.some(rev => rev.reversal_of === s.id) ? (
                            <button
                              type="button"
                              className="btn btn-quiet"
                              style={{ color: 'var(--status-red)', minHeight: '36px', height: '36px', fontSize: '0.8125rem' }}
                              onClick={() => setVoidSaleId(s.id)}
                            >
                              Void
                            </button>
                          ) : (
                            <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                              {s.quantity < 0 ? 'Reversal' : 'Voided'}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No sales recorded today.</p>
                )}
              </div>

              {/* Void Sale Dialog */}
              {voidSaleId && (
                <div className="modal-overlay" onClick={() => setVoidSaleId(null)}>
                  <div className="bottom-sheet" onClick={(e) => e.stopPropagation()}>
                    <h3 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: 'var(--spacing-3)' }}>Void Sale #{voidSaleId}</h3>
                    <form onSubmit={handleVoidSale}>
                      <div className="form-group">
                        <label className="form-label" htmlFor="void-reason">Reason for Void</label>
                        <input
                          id="void-reason"
                          type="text"
                          className="input-large"
                          placeholder="e.g. Accidental double entry"
                          value={voidReason}
                          onChange={(e) => setVoidReason(e.target.value)}
                          required
                        />
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-2)' }}>
                        <button type="button" className="btn btn-secondary" onClick={() => setVoidSaleId(null)}>Cancel</button>
                        <button type="submit" className="btn btn-primary" style={{ backgroundColor: 'var(--status-red)' }}>Confirm Void</button>
                      </div>
                    </form>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 5. MONEY VIEW */}
          {activeTab === 'money' && (
            <div className="card">
              <h3 style={{ fontSize: '1.125rem', fontWeight: 800, marginBottom: 'var(--spacing-4)' }}>Financial Breakdown</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 'var(--spacing-2)', borderBottom: '1px solid var(--border-subtle)' }}>
                  <span>Expected Revenue</span>
                  <strong className="num">₹{(moneyLog?.expectedRevenue || 0).toLocaleString('en-IN')}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 'var(--spacing-2)', borderBottom: '1px solid var(--border-subtle)' }}>
                  <span>Cash Collected</span>
                  <strong className="num">₹{(moneyLog?.cash || 0).toLocaleString('en-IN')}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 'var(--spacing-2)', borderBottom: '1px solid var(--border-subtle)' }}>
                  <span>UPI Collected</span>
                  <strong className="num">₹{(moneyLog?.upi || 0).toLocaleString('en-IN')}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 'var(--spacing-2)', borderBottom: '2px solid var(--text-primary)' }}>
                  <strong style={{ fontSize: '1.0625rem' }}>Total Received</strong>
                  <strong className="num" style={{ fontSize: '1.125rem', color: 'var(--status-green)' }}>
                    ₹{(moneyLog?.totalReceived || 0).toLocaleString('en-IN')}
                  </strong>
                </div>
              </div>
            </div>
          )}

          {/* 6. REPORTS VIEW */}
          {activeTab === 'reports' && (
            <div className="card">
              <h3 style={{ fontSize: '1.125rem', fontWeight: 800, marginBottom: 'var(--spacing-4)' }}>Daily P&L Report</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 'var(--spacing-2)', borderBottom: '1px solid var(--border-subtle)' }}>
                  <span>Total Glasses Sold</span>
                  <strong className="num">{reportsData?.totalGlassesSold || 0}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 'var(--spacing-2)', borderBottom: '1px solid var(--border-subtle)' }}>
                  <span>Total Revenue (₹40/glass)</span>
                  <strong className="num" style={{ color: 'var(--status-green)' }}>
                    ₹{(reportsData?.totalRevenue || 0).toLocaleString('en-IN')}
                  </strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 'var(--spacing-2)', borderBottom: '1px solid var(--border-subtle)' }}>
                  <span>Direct Product Cost (₹20/glass)</span>
                  <strong className="num" style={{ color: 'var(--status-red)' }}>
                    - ₹{(reportsData?.totalProductCost || 0).toLocaleString('en-IN')}
                  </strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 'var(--spacing-2)' }}>
                  <strong style={{ fontSize: '1.125rem' }}>Operating Profit</strong>
                  <strong className="num" style={{ fontSize: '1.25rem', color: 'var(--status-green)' }}>
                    ₹{(reportsData?.estimatedOperatingProfit || 0).toLocaleString('en-IN')}
                  </strong>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Mobile Bottom Tab Navigation Bar */}
      <div className="mobile-nav-bar">
        {NAV_ITEMS.map((item) => {
          const IconComp = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              className={`mobile-nav-item ${isActive ? 'mobile-nav-item-active' : ''}`}
              onClick={() => setActiveTab(item.id)}
            >
              <IconComp size={20} strokeWidth={1.5} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* Reopen Day Modal */}
      {showReopenModal && (
        <div className="modal-overlay" onClick={() => setShowReopenModal(false)}>
          <div className="bottom-sheet" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: 'var(--spacing-3)' }}>Reopen Day</h3>
            <form onSubmit={handleReopenDay}>
              <div className="form-group">
                <label className="form-label" htmlFor="reopen-reason">Reason for Reopening</label>
                <input
                  id="reopen-reason"
                  type="text"
                  className="input-large"
                  placeholder="e.g. Closing entry correction needed"
                  value={reopenReason}
                  onChange={(e) => setReopenReason(e.target.value)}
                  required
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-2)' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowReopenModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ backgroundColor: 'var(--brand-accent)' }}>Reopen Day</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
