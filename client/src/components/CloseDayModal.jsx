import React, { useState } from 'react';
import { api } from '../api';

export default function CloseDayModal({ isOpen, onClose, onSuccess }) {
  const [actualRemaining, setActualRemaining] = useState('');
  const [cashReceived, setCashReceived] = useState('');
  const [upiReceived, setUpiReceived] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleStartConfirm = (e) => {
    e.preventDefault();
    if (actualRemaining === '' || cashReceived === '' || upiReceived === '') {
      setError('Please enter actual remaining stock, cash, and UPI collected.');
      return;
    }
    setError('');
    setConfirming(true);
  };

  const handleFinalSubmit = async () => {
    setLoading(true);
    setError('');

    try {
      await api.closeDay({
        actual_remaining: Number(actualRemaining),
        cash_received: Number(cashReceived),
        upi_received: Number(upiReceived)
      });
      setSubmitted(true);
      if (onSuccess) onSuccess();
    } catch (err) {
      setError(err.message || 'Failed to submit daily closing');
      setConfirming(false);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setConfirming(false);
    setSubmitted(false);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">DAILY CLOSING</h2>
          <button className="btn-close-modal" onClick={handleClose}>&times;</button>
        </div>

        {error && <div className="badge badge-danger" style={{ marginBottom: 12, width: '100%' }}>{error}</div>}

        {submitted ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div className="badge badge-success" style={{ fontSize: '1.2rem', padding: '12px 24px', marginBottom: 16 }}>
              ✓ Day closed
            </div>
            <button className="btn-submit" onClick={handleClose}>
              DONE
            </button>
          </div>
        ) : confirming ? (
          <div style={{ padding: '10px 0' }}>
            <div className="card" style={{ background: '#f8fafc', marginBottom: 16, padding: 16, textAlign: 'center' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: 12 }}>CONFIRM CLOSING VALUES</h3>
              <p style={{ fontSize: '1.05rem', fontWeight: 700, color: '#1e293b', lineHeight: 1.6 }}>
                Remaining {actualRemaining}, Cash ₹{cashReceived}, UPI ₹{upiReceived}.
              </p>
              <p style={{ fontSize: '0.9rem', color: '#64748b', marginTop: 8 }}>
                Is this information correct?
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <button
                type="button"
                className="btn-action"
                style={{ background: '#f1f5f9', color: '#475569' }}
                onClick={() => setConfirming(false)}
                disabled={loading}
              >
                BACK
              </button>
              <button
                type="button"
                className="btn-submit"
                style={{ marginTop: 0 }}
                onClick={handleFinalSubmit}
                disabled={loading}
              >
                {loading ? 'Submitting...' : 'CONFIRM'}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleStartConfirm}>
            <div className="form-group">
              <label className="form-label">Actual Remaining Stock (Glasses)</label>
              <input
                type="number"
                className="form-input"
                placeholder="e.g. 12"
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

            <button type="submit" className="btn-submit">
              REVIEW CLOSING
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
