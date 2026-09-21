import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Wifi, WifiOff, Package, Check, RotateCcw, Trash2, CalendarCheck, AlertTriangle, RefreshCw, PlayCircle } from 'lucide-react';
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
  const [showCheckAnim, setShowCheckAnim] = useState(false);
  const [showWastageModal, setShowWastageModal] = useState(false);
  const [showCloseDayModal, setShowCloseDayModal] = useState(false);
  const [selectedDispatch, setSelectedDispatch] = useState(null);
  const [customReceiptQty, setCustomReceiptQty] = useState('');
  const [lastSaleTime, setLastSaleTime] = useState(null);
  const [undoTimeLeft, setUndoTimeLeft] = useState(0);
  const [lastSaleQuantity, setLastSaleQuantity] = useState(1);
  const [error, setError] = useState('');

  const undoTimerRef = useRef(null);
  const wakeLockRef = useRef(null);

  // Screen Wake Lock API
  const requestWakeLock = useCallback(async () => {
    if ('wakeLock' in navigator) {
      try {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
      } catch (e) {
        // Fail silently if wake lock is unsupported or fails
      }
    }
  }, []);

  useEffect(() => {
    requestWakeLock();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
      }
    };
  }, [requestWakeLock]);

  const fetchDashboard = useCallback(async () => {
    try {
      const data = await api.getStallDashboard();
      setDashboard(data);
      setError('');
    } catch (err) {
      setError('Not saved. Tap again, or note it on paper.');
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

  // Undo Timer countdown (10s UI window)
  useEffect(() => {
    if (undoTimeLeft > 0) {
      undoTimerRef.current = setInterval(() => {
        setUndoTimeLeft(prev => prev - 1);
      }, 1000);
    }
    return () => clearInterval(undoTimerRef.current);
  }, [undoTimeLeft]);

  const handleStartDay = async () => {
    try {
      await api.startDay();
      fetchDashboard();
    } catch (err) {
      setError(err.message || 'Failed to start day');
    }
  };

  const handleSellOne = async () => {
    if (selling || dashboard?.closingSubmitted || !dashboard?.dayStarted) return;
    setSelling(true);

    // Haptic feedback (30ms vibration)
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(30); } catch (e) {}
    }

    const idempotency_key = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `sell_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    try {
      const res = await api.sellOne(idempotency_key);
      setDashboard(prev => prev ? { ...prev, soldToday: res.soldToday } : prev);
      setShowCheckAnim(true);
      setTimeout(() => setShowCheckAnim(false), 800);

      const now = new Date();
      setLastSaleTime(now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      setLastSaleQuantity(1);
      setUndoTimeLeft(10); // 10s UI window
      setError('');
      fetchDashboard();
    } catch (err) {
      setError(err.message || 'Not saved. Tap again, or note it on paper.');
    } finally {
      setTimeout(() => setSelling(false), 200);
    }
  };

  const handleSellParcel = async () => {
    if (selling || dashboard?.closingSubmitted || !dashboard?.dayStarted) return;
    if ((dashboard?.computedRemaining || 0) < 3) return;
    setSelling(true);

    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(30); } catch (e) {}
    }

    const idempotency_key = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `parcel_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    try {
      const res = await api.sellParcel(idempotency_key);
      setDashboard(prev => prev ? { ...prev, soldToday: res.soldToday } : prev);
      setShowCheckAnim(true);
      setTimeout(() => setShowCheckAnim(false), 800);

      const now = new Date();
      setLastSaleTime(now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      setLastSaleQuantity(3);
      setUndoTimeLeft(10);
      setError('');
      fetchDashboard();
    } catch (err) {
      setError(err.message || 'Not saved. Tap again.');
    } finally {
      setTimeout(() => setSelling(false), 200);
    }
  };

  const handleUndoLast = async () => {
    if (undoing || undoTimeLeft <= 0 || dashboard?.closingSubmitted) return;
    setUndoing(true);

    try {
      await api.undoLastSale();
      setUndoTimeLeft(0);
      setError('');
      fetchDashboard();
    } catch (err) {
      setError(err.message || 'Failed to undo last sale');
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

  if (loading) {
    return (
      <div className="app-shell">
        <Navbar onLogout={onLogout} />
        <div className="worker-container" style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
          <p style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Loading Stall Data...</p>
        </div>
      </div>
    );
  }

  const pendingDispatches = dashboard?.pendingDispatches || [];

  return (
    <div className="app-shell">
      <Navbar onLogout={onLogout} />

      <div className="worker-container" style={{ padding: 'var(--spacing-4)' }}>
        {/* Top Header Bar: Stall Name & Connection Status Pill */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-3)' }}>
          <div>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 800 }}>
              {dashboard?.stall?.name || 'Stall 1'}
            </h1>
            <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
              {dashboard?.product?.name || 'Butter Fruit Payasam'} &bull; ₹40
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)' }}>
            <span className={`status-pill ${!dashboard?.dayStarted ? 'status-pill-amber' : dashboard?.closingSubmitted ? 'status-pill-amber' : isConnected ? 'status-pill-green' : 'status-pill-red'}`}>
              {!dashboard?.dayStarted ? (
                <span>Not started</span>
              ) : dashboard?.closingSubmitted ? (
                <span>Closed</span>
              ) : (
                <>
                  {isConnected ? <Wifi size={14} strokeWidth={2} /> : <WifiOff size={14} strokeWidth={2} />}
                  <span>{isConnected ? 'Live' : 'Offline'}</span>
                </>
              )}
            </span>
          </div>
        </div>

        {/* Banner for Error / Status */}
        {error && (
          <div className="card" style={{ borderLeft: '4px solid var(--status-red)', backgroundColor: 'var(--status-red-bg)', color: 'var(--status-red)', padding: 'var(--spacing-3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--spacing-2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)', fontSize: '0.9375rem', fontWeight: 600 }}>
              <AlertTriangle size={20} strokeWidth={1.5} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
            <button
              type="button"
              className="btn btn-quiet"
              style={{ minHeight: '36px', height: '36px', padding: '0 8px', fontSize: '0.8125rem', color: 'var(--status-red)' }}
              onClick={fetchDashboard}
            >
              <RefreshCw size={14} strokeWidth={1.5} />
              <span>Retry</span>
            </button>
          </div>
        )}

        {/* Day Not Started Screen */}
        {!dashboard?.dayStarted ? (
          <div className="card" style={{ textAlign: 'center', padding: 'var(--spacing-6) var(--spacing-4)', marginTop: 'var(--spacing-4)' }}>
            <div style={{ width: 56, height: 56, borderRadius: 'var(--radius-full)', backgroundColor: 'var(--status-amber-bg)', color: 'var(--brand-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto var(--spacing-3)' }}>
              <PlayCircle size={32} strokeWidth={1.5} />
            </div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: 'var(--spacing-2)' }}>Start Day</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9375rem', marginBottom: 'var(--spacing-6)' }}>
              Press Start Day to begin recording sales for Stall 1 today.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%', minHeight: '52px', fontSize: '1.125rem' }}
              onClick={handleStartDay}
            >
              Start Day
            </button>
          </div>
        ) : dashboard?.closingSubmitted ? (
          /* Closed Day View for Stall Worker */
          <div className="card" style={{ textAlign: 'center', padding: 'var(--spacing-6) var(--spacing-4)', marginTop: 'var(--spacing-4)' }}>
            <div style={{ width: 56, height: 56, borderRadius: 'var(--radius-full)', backgroundColor: 'var(--status-green-bg)', color: 'var(--status-green)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto var(--spacing-3)' }}>
              <CalendarCheck size={32} strokeWidth={1.5} />
            </div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: 'var(--spacing-2)' }}>Day Closed</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9375rem' }}>
              Total sold today: <strong className="num">{dashboard?.soldToday || 0}</strong> glasses
            </p>
          </div>
        ) : (
          /* Active Selling View */
          <div>
            {/* Pending Stock Cards */}
            {pendingDispatches.map((dispatch) => (
              <div key={dispatch.id} className="card" style={{ borderLeft: '4px solid var(--brand-accent)', backgroundColor: 'var(--status-amber-bg)', marginBottom: 'var(--spacing-3)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)', marginBottom: 'var(--spacing-2)' }}>
                  <Package size={20} strokeWidth={1.5} style={{ color: 'var(--brand-accent)' }} />
                  <strong style={{ fontSize: '1rem' }}>Stock Dispatched</strong>
                </div>

                <p style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: 'var(--spacing-3)' }} className="num">
                  Stock sent: {dispatch.quantity} glasses
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2)' }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => handleConfirmReceipt(dispatch, dispatch.quantity)}
                  >
                    <Check size={18} strokeWidth={1.5} />
                    <span>Confirm Receipt</span>
                  </button>

                  {selectedDispatch?.id === dispatch.id ? (
                    <div style={{ display: 'flex', gap: 'var(--spacing-2)', marginTop: 'var(--spacing-2)' }}>
                      <input
                        type="number"
                        inputMode="numeric"
                        className="input-large num"
                        style={{ minHeight: '44px', fontSize: '1rem' }}
                        placeholder="Enter count"
                        value={customReceiptQty}
                        onChange={(e) => setCustomReceiptQty(e.target.value)}
                      />
                      <button
                        type="button"
                        className="btn btn-primary"
                        style={{ minHeight: '44px' }}
                        onClick={() => handleConfirmReceipt(dispatch, customReceiptQty)}
                      >
                        Save
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-quiet"
                      style={{ fontSize: '0.875rem' }}
                      onClick={() => { setSelectedDispatch(dispatch); setCustomReceiptQty(String(dispatch.quantity)); }}
                    >
                      Count is different?
                    </button>
                  )}
                </div>
              </div>
            ))}

            {/* Today's Sold Count Hero */}
            <div className="hero-sold-container">
              <div className="hero-sold-label">Glasses Sold Today</div>
              <div className="hero-number num">{dashboard?.soldToday || 0}</div>
            </div>

            {/* HERO SELLING STACK: 3/4 GLASS & 1/4 PARCEL (3:1 Vertical Height Ratio) */}
            <div className="hero-sell-row">
              <button
                type="button"
                className="btn-giant-sell"
                onClick={handleSellOne}
                disabled={selling || (dashboard?.computedRemaining || 0) < 1}
                style={{
                  opacity: (dashboard?.computedRemaining || 0) < 1 ? 0.6 : 1,
                  cursor: (dashboard?.computedRemaining || 0) < 1 ? 'not-allowed' : 'pointer'
                }}
              >
                {(dashboard?.computedRemaining || 0) < 1 ? (
                  <span className="btn-giant-sell-label" style={{ fontSize: '1.5rem' }}>ITEM FINISHED</span>
                ) : showCheckAnim ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                    <Check size={36} strokeWidth={2} />
                    <span className="btn-giant-sell-label" style={{ fontSize: '1.5rem' }}>RECORDED!</span>
                  </div>
                ) : (
                  <>
                    <span className="btn-giant-sell-label">GLASS</span>
                    <span className="btn-giant-sell-subtext">₹40 per glass</span>
                  </>
                )}
              </button>

              <button
                type="button"
                className="btn-parcel-sell"
                onClick={handleSellParcel}
                disabled={selling || (dashboard?.computedRemaining || 0) < 3}
                style={{
                  opacity: (dashboard?.computedRemaining || 0) < 3 ? 0.5 : 1,
                  cursor: (dashboard?.computedRemaining || 0) < 3 ? 'not-allowed' : 'pointer'
                }}
              >
                {(dashboard?.computedRemaining || 0) < 3 ? (
                  <span className="btn-parcel-sell-label" style={{ fontSize: '1rem' }}>NO STOCK</span>
                ) : (
                  <>
                    <span className="btn-parcel-sell-label">PARCEL</span>
                    <span className="btn-parcel-sell-subtext">₹120 • 3 glasses</span>
                  </>
                )}
              </button>
            </div>

            {/* Stat Row: Received count & Last sale time */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 var(--spacing-2)', marginBottom: 'var(--spacing-3)', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              <span>Received: <strong className="num">{dashboard?.stockReceived || 0}</strong></span>
              <span>{lastSaleTime ? `Last sale ${lastSaleTime}` : 'No sales yet'}</span>
            </div>

            {/* 10-Second Countdown for Undo Last Sale (Visually hidden after 10s) */}
            {undoTimeLeft > 0 && (
              <div className="undo-container">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ width: '100%', minHeight: '44px', fontSize: '0.9375rem' }}
                    onClick={handleUndoLast}
                    disabled={undoing}
                  >
                    <RotateCcw size={16} strokeWidth={1.5} />
                    <span>{lastSaleQuantity === 3 ? `Undo parcel (3) (${undoTimeLeft}s)` : `Undo (${undoTimeLeft}s)`}</span>
                  </button>
                </div>
                <div className="undo-progress-bar" style={{ width: `${(undoTimeLeft / 10) * 100}%` }} />
              </div>
            )}

            {/* Quiet Secondary Action Buttons at Bottom */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-3)', marginTop: 'var(--spacing-6)' }}>
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => setShowWastageModal(true)}
                disabled={(dashboard?.computedRemaining || 0) < 1}
              >
                <Trash2 size={18} strokeWidth={1.5} />
                <span>{(dashboard?.computedRemaining || 0) < 1 ? 'Item finished' : 'Wastage'}</span>
              </button>

              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => setShowCloseDayModal(true)}
              >
                <CalendarCheck size={18} strokeWidth={1.5} />
                <span>Close Day</span>
              </button>
            </div>
          </div>
        )}
      </div>

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
        soldToday={dashboard?.soldToday}
        computedRemaining={dashboard?.computedRemaining}
      />
    </div>
  );
}
