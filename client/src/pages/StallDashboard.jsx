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
  const [undoing, setUndoing] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [showWastageModal, setShowWastageModal] = useState(false);
  const [showCloseDayModal, setShowCloseDayModal] = useState(false);
  const [customReceiptQty, setCustomReceiptQty] = useState('');
  const [selectedDispatch, setSelectedDispatch] = useState(null);
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

  const handleWSEvent = useCallback((event) => {
    if (event.type === 'STALL_ACTION') {
      fetchDashboard();
    }
  }, [fetchDashboard]);

  const { isConnected } = useWebSocket(handleWSEvent);

  useEffect(() => {
    fetchDashboard();
    const interval = setInterval(fetchDashboard, 10000);
    return () => clearInterval(interval);
  }, [fetchDashboard]);

  const handleSellOne = async () => {
    if (selling) return;
    setSelling(true);

    const idempotency_key = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `sell_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    try {
      const res = await api.sellOne(idempotency_key);
      setDashboard(prev => prev ? {
        ...prev,
        soldToday: res.soldToday
      } : prev);

      setToastMessage(res.warning ? `✓ Sale Recorded (${res.warning})` : '✓ Sale Recorded (+1)');

      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => setToastMessage(''), 2000);

      fetchDashboard();
    } catch (err) {
      setError(err.message || 'Failed to record sale');
    } finally {
      setTimeout(() => setSelling(false), 300);
    }
  };

  const handleUndoLast = async () => {
    if (undoing) return;
    setUndoing(true);

    try {
      await api.undoLastSale();
      setToastMessage('↺ Last Sale Undone');
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => setToastMessage(''), 2000);
      fetchDashboard();
    } catch (err) {
      setError(err.message || 'Failed to undo sale');
    } finally {
      setUndoing(false);
    }
  };

  const handleConfirmReceipt = async (dispatch, qtyInput) => {
    try {
      const qty = qtyInput !== undefined ? Number(qtyInput) : dispatch.quantity;
      await api.confirmReceipt(dispatch.id, qty);
      setSelectedDispatch(null);
      setCustomReceiptQty('');
      fetchDashboard();
    } catch (err) {
      setError(err.message || 'Failed to confirm stock receipt');
    }
  };

  const formatDate = () => {
    const options = { weekday: 'long', day: 'numeric', month: 'long' };
    return new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', ...options });
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
              <div className="dispatch-title">📦 STOCK DISPATCHED</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 800, marginTop: 2 }}>
                {dispatch.quantity} glasses
              </div>
              <div style={{ fontSize: '0.8rem', color: '#9a3412' }}>
                Dispatched by {dispatch.dispatched_by_name || 'Admin'}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, flexDirection: 'column' }}>
              <button
                className="btn-confirm-receipt"
                onClick={() => handleConfirmReceipt(dispatch, dispatch.quantity)}
              >
                CONFIRM RECEIPT ({dispatch.quantity})
              </button>

              {selectedDispatch?.id === dispatch.id ? (
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <input
                    type="number"
                    className="form-input"
                    placeholder="Enter counted qty"
                    value={customReceiptQty}
                    onChange={(e) => setCustomReceiptQty(e.target.value)}
                    style={{ padding: '8px', fontSize: '0.9rem' }}
                  />
                  <button
                    className="btn-action"
                    style={{ background: '#ea580c', color: 'white', padding: '8px 12px', fontSize: '0.9rem' }}
                    onClick={() => handleConfirmReceipt(dispatch, customReceiptQty)}
                  >
                    Save
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  style={{ background: 'none', border: 'none', color: '#c2410c', textDecoration: 'underline', fontSize: '0.85rem', cursor: 'pointer', fontWeight: 700 }}
                  onClick={() => { setSelectedDispatch(dispatch); setCustomReceiptQty(String(dispatch.quantity)); }}
                >
                  Count is different?
                </button>
              )}
            </div>
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
            disabled={selling || dashboard?.closingSubmitted}
          >
            <span>SELL 1</span>
            <span className="btn-sell-subtext">₹40 / glass</span>
          </button>

          {toastMessage && (
            <div className="sale-toast">
              {toastMessage}
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btn-action"
              style={{ background: '#f1f5f9', color: '#475569', fontSize: '0.9rem', width: '100%', padding: '10px' }}
              onClick={handleUndoLast}
              disabled={undoing || dashboard?.closingSubmitted}
            >
              ↺ UNDO LAST SALE (120s)
            </button>
          </div>
        </div>

        {/* Stock Summary Card (Sold and Received ONLY - No Expected Left) */}
        <div className="card">
          <div className="card-title">Today's Stock</div>
          <div className="stock-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="stock-item">
              <div className="stock-label">Received</div>
              <div className="stock-value">{dashboard?.stockReceived || 0}</div>
            </div>
            <div className="stock-item">
              <div className="stock-label">Sold</div>
              <div className="stock-value">{dashboard?.soldToday || 0}</div>
            </div>
          </div>
        </div>

        {/* Action Buttons: Wastage & Close Day */}
        <div className="actions-row">
          <button
            className="btn-action btn-wastage"
            onClick={() => setShowWastageModal(true)}
            disabled={dashboard?.closingSubmitted}
          >
            <span>🗑️ WASTAGE</span>
          </button>

          <button
            className="btn-action btn-close-day"
            onClick={() => setShowCloseDayModal(true)}
            disabled={dashboard?.closingSubmitted}
          >
            <span>📊 CLOSE DAY</span>
          </button>
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
        onSuccess={fetchDashboard}
      />
    </div>
  );
}
