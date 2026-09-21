import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api';
import { useWebSocket } from '../useWebSocket';
import Navbar from '../components/Navbar';
import WastageModal from '../components/WastageModal';
import CloseDayModal from '../components/CloseDayModal';

export default function StallDashboard({ onLogout }) {
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selling, setSelling] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [showWastageModal, setShowWastageModal] = useState(false);
  const [showCloseDayModal, setShowCloseDayModal] = useState(false);
  const [error, setError] = useState('');

  const toastTimerRef = useRef(null);

  const fetchDashboard = useCallback(async () => {
    try {
      const data = await api.getStallDashboard();
      setDashboard(data);
      setError('');
    } catch (err) {
      setError(err.message || 'Failed to load stall data');
    } finally {
      setLoading(false);
    }
  }, []);

  // Handle incoming real-time events (e.g. stock dispatched by admin)
  const handleWSEvent = useCallback((event) => {
    if (event.type === 'STALL_ACTION' && event.payload?.eventType === 'DISPATCH') {
      fetchDashboard();
    }
  }, [fetchDashboard]);

  // Connect WebSocket & Heartbeat
  const { isConnected } = useWebSocket(handleWSEvent);

  useEffect(() => {
    fetchDashboard();
    const interval = setInterval(fetchDashboard, 10000); // Poll fallback
    return () => clearInterval(interval);
  }, [fetchDashboard]);

  const handleSellOne = async () => {
    if (selling) return; // Debounce guard

    setSelling(true);

    try {
      const res = await api.sellOne();
      setDashboard(prev => prev ? {
        ...prev,
        soldToday: res.soldToday,
        expectedRemaining: prev.stockReceived - res.soldToday - prev.wastageToday,
        expectedRevenue: res.expectedRevenue
      } : prev);

      setToastMessage('✓ Sale Recorded (+1)');

      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => setToastMessage(''), 1500);

      // Refresh full dashboard async
      fetchDashboard();
    } catch (err) {
      setError(err.message || 'Failed to record sale');
    } finally {
      setTimeout(() => setSelling(false), 300); // 300ms debounce buffer
    }
  };

  const handleConfirmReceipt = async (dispatch_id) => {
    try {
      await api.confirmReceipt(dispatch_id);
      fetchDashboard();
    } catch (err) {
      setError(err.message || 'Failed to confirm stock receipt');
    }
  };

  const formatDate = () => {
    const options = { weekday: 'long', day: 'numeric', month: 'long' };
    return new Date().toLocaleDateString('en-US', options);
  };

  if (loading) {
    return (
      <div className="app-container">
        <Navbar onLogout={onLogout} />
        <div className="main-content" style={{ textAlign: 'center', paddingTop: 40 }}>
          <p style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>Loading Stall 1 Dashboard...</p>
        </div>
      </div>
    );
  }

  const pendingDispatches = dashboard?.pendingDispatches || [];

  return (
    <div className="app-container">
      <Navbar onLogout={onLogout} />

      <main className="main-content">
        {/* Header Title & Connection Badge */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h1 style={{ fontSize: '1.4rem', fontWeight: 900, color: '#064e3b' }}>
                {dashboard?.stall?.name || 'PAYASAM STALL 1'}
              </h1>
              <span className={`badge ${isConnected ? 'badge-success' : 'badge-warning'}`} style={{ fontSize: '0.75rem', padding: '2px 8px' }}>
                {isConnected ? '🟢 Live' : '🟠 Offline'}
              </span>
            </div>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
              Today &bull; {formatDate()}
            </p>
          </div>
          {dashboard?.closingSubmitted && (
            <span className="badge badge-success">Day Closed</span>
          )}
        </div>

        {error && (
          <div className="badge badge-danger" style={{ width: '100%', padding: 10 }}>
            {error}
          </div>
        )}

        {/* Stock Received Dispatch Banners */}
        {pendingDispatches.map((dispatch) => (
          <div key={dispatch.id} className="dispatch-banner">
            <div>
              <div className="dispatch-title">📦 STOCK RECEIVED</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 800, marginTop: 2 }}>
                {dispatch.quantity} glasses
              </div>
              <div style={{ fontSize: '0.8rem', color: '#9a3412' }}>
                Dispatched by {dispatch.dispatched_by_name || 'Admin'}
              </div>
            </div>
            <button
              className="btn-confirm-receipt"
              onClick={() => handleConfirmReceipt(dispatch.id)}
            >
              CONFIRM RECEIPT
            </button>
          </div>
        ))}

        {/* Product Card & MASSIVE SELL 1 Button */}
        <div className="card sell-product-card">
          <div className="product-name">
            {dashboard?.product?.name || 'BUTTER FRUIT PAYASAM'}
          </div>
          <div className="sold-today-count">
            Sold Today: <span className="sold-today-number">{dashboard?.soldToday || 0}</span> glasses
          </div>

          <button
            className="btn-sell-1"
            onClick={handleSellOne}
            disabled={selling}
          >
            <span>SELL 1</span>
            <span className="btn-sell-subtext">₹{dashboard?.product?.selling_price || 40} / glass</span>
          </button>

          {toastMessage && (
            <div className="sale-toast">
              {toastMessage}
            </div>
          )}
        </div>

        {/* Stock Summary Card */}
        <div className="card">
          <div className="card-title">Stock</div>
          <div className="stock-grid">
            <div className="stock-item">
              <div className="stock-label">Received</div>
              <div className="stock-value">{dashboard?.stockReceived || 0}</div>
            </div>
            <div className="stock-item">
              <div className="stock-label">Sold</div>
              <div className="stock-value">{dashboard?.soldToday || 0}</div>
            </div>
            <div className="stock-item">
              <div className="stock-label">Expected</div>
              <div className="stock-value expected">{dashboard?.expectedRemaining || 0}</div>
            </div>
          </div>
        </div>

        {/* Action Buttons: Wastage & Close Day */}
        <div className="actions-row">
          <button
            className="btn-action btn-wastage"
            onClick={() => setShowWastageModal(true)}
          >
            <span>🗑️ WASTAGE</span>
          </button>

          <button
            className="btn-action btn-close-day"
            onClick={() => setShowCloseDayModal(true)}
          >
            <span>📊 CLOSE DAY</span>
          </button>
        </div>

        {/* Today's Revenue Display */}
        <div className="revenue-card">
          <div>
            <div className="revenue-label">Today's Revenue</div>
            <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
              {dashboard?.soldToday || 0} glasses @ ₹{dashboard?.product?.selling_price || 40}
            </div>
          </div>
          <div className="revenue-amount">
            ₹{(dashboard?.expectedRevenue || 0).toLocaleString()}
          </div>
        </div>
      </main>

      {/* Modals */}
      <WastageModal
        isOpen={showWastageModal}
        onClose={() => setShowWastageModal(false)}
        onSuccess={fetchDashboard}
      />

      <CloseDayModal
        isOpen={showCloseDayModal}
        onClose={() => setShowCloseDayModal(false)}
        dashboardData={dashboard}
        onSuccess={fetchDashboard}
      />
    </div>
  );
}
