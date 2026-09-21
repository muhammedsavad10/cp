import React, { useState, useEffect } from 'react';
import { api } from '../api';

export default function CloseDayModal({ isOpen, onClose, dashboardData, onSuccess }) {
  const [actualRemaining, setActualRemaining] = useState('');
  const [cashReceived, setCashReceived] = useState('');
  const [upiReceived, setUpiReceived] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (dashboardData?.expectedRemaining !== undefined) {
      setActualRemaining(dashboardData.expectedRemaining);
    }
  }, [dashboardData]);

  if (!isOpen || !dashboardData) return null;

  const sold = dashboardData.soldToday || 0;
  const expectedRemaining = dashboardData.expectedRemaining || 0;
  const wastage = dashboardData.wastageToday || 0;
  const expectedRevenue = dashboardData.expectedRevenue || 0;

  const cashVal = parseFloat(cashReceived) || 0;
  const upiVal = parseFloat(upiReceived) || 0;
  const totalReceived = cashVal + upiVal;
  const difference = totalReceived - expectedRevenue;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (actualRemaining === '' || cashReceived === '' || upiReceived === '') {
      setError('Please fill in actual remaining stock, cash, and UPI collected.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await api.closeDay({
        actual_remaining: Number(actualRemaining),
        cash_received: Number(cashReceived),
        upi_received: Number(upiReceived)
      });
      onSuccess();
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to submit daily closing');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">DAILY CLOSING</h2>
          <button className="btn-close-modal" onClick={onClose}>&times;</button>
        </div>

        {error && <div className="badge badge-danger" style={{ marginBottom: 12, width: '100%' }}>{error}</div>}

        <div className="stock-grid" style={{ marginBottom: 16 }}>
          <div className="stock-item">
            <div className="stock-label">Sales</div>
            <div className="stock-value">{sold}</div>
          </div>
          <div className="stock-item">
            <div className="stock-label">Wastage</div>
            <div className="stock-value">{wastage}</div>
          </div>
          <div className="stock-item">
            <div className="stock-label">Exp. Remaining</div>
            <div className="stock-value expected">{expectedRemaining}</div>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Actual Remaining Stock (Verification)</label>
            <input
              type="number"
              className="form-input"
              placeholder="e.g. 13"
              value={actualRemaining}
              onChange={(e) => setActualRemaining(e.target.value)}
              required
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">Cash Collected (₹)</label>
              <input
                type="number"
                className="form-input"
                placeholder="₹ Cash"
                value={cashReceived}
                onChange={(e) => setCashReceived(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">UPI Collected (₹)</label>
              <input
                type="number"
                className="form-input"
                placeholder="₹ UPI"
                value={upiReceived}
                onChange={(e) => setUpiReceived(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="card" style={{ background: '#f8fafc', padding: 14, margin: '12px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: '0.9rem', color: '#64748b', fontWeight: 600 }}>Expected Revenue:</span>
              <span style={{ fontWeight: 800 }}>₹{expectedRevenue.toLocaleString()}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: '0.9rem', color: '#64748b', fontWeight: 600 }}>Cash + UPI:</span>
              <span style={{ fontWeight: 800 }}>₹{totalReceived.toLocaleString()}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 6, borderTop: '1px solid #e2e8f0' }}>
              <span style={{ fontSize: '0.95rem', fontWeight: 700 }}>Difference:</span>
              <span style={{ fontWeight: 900, color: difference === 0 ? '#16a34a' : '#dc2626' }}>
                ₹{difference > 0 ? `+${difference}` : difference}
              </span>
            </div>
          </div>

          {/* Status Badge */}
          {cashReceived !== '' || upiReceived !== '' ? (
            <div style={{ marginBottom: 12, textAlign: 'center' }}>
              {difference === 0 ? (
                <span className="badge badge-success" style={{ fontSize: '1rem', padding: '8px 16px' }}>
                  🟢 Everything matches
                </span>
              ) : (
                <span className="badge badge-danger" style={{ fontSize: '1rem', padding: '8px 16px' }}>
                  🔴 ₹{Math.abs(difference)} discrepancy
                </span>
              )}
            </div>
          ) : null}

          <button type="submit" className="btn-submit" disabled={loading}>
            {loading ? 'Submitting...' : 'SUBMIT DAY'}
          </button>
        </form>
      </div>
    </div>
  );
}
