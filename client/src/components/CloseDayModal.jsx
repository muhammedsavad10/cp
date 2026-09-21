import React, { useState } from 'react';
import { CheckCircle, X } from 'lucide-react';
import { api } from '../api';

export default function CloseDayModal({ isOpen, onClose, onSuccess, computedRemaining }) {
  const [cashReceived, setCashReceived] = useState('');
  const [upiReceived, setUpiReceived] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleFinalSubmit = async (e) => {
    e.preventDefault();
    if (cashReceived === '' || upiReceived === '') {
      setError('Please enter cash and UPI collected.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await api.closeDay({
        cash_received: Number(cashReceived),
        upi_received: Number(upiReceived)
      });
      setSubmitted(true);
      if (onSuccess) onSuccess();
    } catch (err) {
      setError(err.message || "Amount doesn't match. Please recheck and re-enter.");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setCashReceived('');
    setUpiReceived('');
    setSubmitted(false);
    setError('');
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={handleReset}>
      <div className="bottom-sheet" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-3)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800 }}>Daily Closing</h2>
          </div>
          <button
            type="button"
            aria-label="Close dialog"
            onClick={handleReset}
            className="btn btn-quiet"
            style={{ minHeight: '36px', width: '36px', padding: 0 }}
          >
            <X size={20} strokeWidth={1.5} />
          </button>
        </div>

        {error && (
          <div className="status-pill status-pill-red" style={{ width: '100%', marginBottom: 'var(--spacing-4)', justifyContent: 'center', padding: '12px', fontSize: '0.9375rem', textAlign: 'center', height: 'auto', borderRadius: 'var(--radius-md)' }}>
            {error}
          </div>
        )}

        {submitted ? (
          /* Confirmation View */
          <div style={{ textAlign: 'center', padding: 'var(--spacing-4) 0' }}>
            <div style={{ width: 64, height: 64, borderRadius: 'var(--radius-full)', backgroundColor: 'var(--status-green-bg)', color: 'var(--status-green)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto var(--spacing-4)' }}>
              <CheckCircle size={36} strokeWidth={1.5} />
            </div>
            <h3 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: 'var(--spacing-2)' }}>Day Closed</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9375rem', marginBottom: 'var(--spacing-6)' }}>
              Closing submitted successfully.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%', minHeight: '52px' }}
              onClick={handleReset}
            >
              Done
            </button>
          </div>
        ) : (
          /* Semi-blind Closing Form */
          <form onSubmit={handleFinalSubmit}>
            {/* Informational computed remaining stock (Read-only) */}
            <div className="card" style={{ backgroundColor: 'var(--bg-main)', marginBottom: 'var(--spacing-4)', padding: 'var(--spacing-3) var(--spacing-4)' }}>
              <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Remaining Stock (System calculated)
              </div>
              <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '2px' }} className="num">
                {computedRemaining !== undefined ? computedRemaining : '--'} glasses
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="close-cash">Cash Collected (₹)</label>
              <input
                id="close-cash"
                type="number"
                inputMode="numeric"
                className="input-large num"
                placeholder="₹ Cash"
                value={cashReceived}
                onChange={(e) => setCashReceived(e.target.value)}
                required
                autoFocus
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="close-upi">UPI Collected (₹)</label>
              <input
                id="close-upi"
                type="number"
                inputMode="numeric"
                className="input-large num"
                placeholder="₹ UPI"
                value={upiReceived}
                onChange={(e) => setUpiReceived(e.target.value)}
                required
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', minHeight: '52px', marginTop: 'var(--spacing-4)' }}
              disabled={loading}
            >
              {loading ? 'Submitting...' : 'Submit Closing'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
