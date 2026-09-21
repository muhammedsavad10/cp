import React, { useState } from 'react';
import { ArrowLeft, CheckCircle, X, Check, ShieldCheck } from 'lucide-react';
import { api } from '../api';

export default function CloseDayModal({ isOpen, onClose, onSuccess }) {
  const [step, setStep] = useState(1);
  const [actualRemaining, setActualRemaining] = useState('');
  const [cashReceived, setCashReceived] = useState('');
  const [upiReceived, setUpiReceived] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleNextStep1 = (e) => {
    e.preventDefault();
    if (actualRemaining === '') {
      setError('Please enter actual remaining stock.');
      return;
    }
    setError('');
    setStep(2);
  };

  const handleNextStep2 = (e) => {
    e.preventDefault();
    if (cashReceived === '' || upiReceived === '') {
      setError('Please enter cash and UPI collected.');
      return;
    }
    setError('');
    setStep(3);
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
      setStep(2);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setStep(1);
    setActualRemaining('');
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
            {step > 1 && !submitted && (
              <button
                type="button"
                aria-label="Back to previous step"
                onClick={() => setStep(prev => prev - 1)}
                className="btn btn-quiet"
                style={{ minHeight: '36px', width: '36px', padding: 0 }}
              >
                <ArrowLeft size={18} strokeWidth={1.5} />
              </button>
            )}
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

        {/* Step Progress Bar */}
        {!submitted && (
          <div style={{ marginBottom: 'var(--spacing-4)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 'var(--spacing-1)' }}>
              <span>Step {step} of 3</span>
              <span>{step === 1 ? 'Remaining Stock' : step === 2 ? 'Cash & UPI' : 'Confirm'}</span>
            </div>
            <div style={{ height: 4, backgroundColor: 'var(--border-subtle)', borderRadius: 'var(--radius-full)', overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${(step / 3) * 100}%`,
                  backgroundColor: 'var(--brand-accent)',
                  transition: 'width var(--transition-normal)'
                }}
              />
            </div>
          </div>
        )}

        {error && (
          <div className="status-pill status-pill-red" style={{ width: '100%', marginBottom: 'var(--spacing-4)', justifyContent: 'center', padding: '10px' }}>
            {error}
          </div>
        )}

        {submitted ? (
          /* State 5: Calm Confirmation with Check Icon */
          <div style={{ textAlign: 'center', padding: 'var(--spacing-4) 0' }}>
            <div style={{ width: 64, height: 64, borderRadius: 'var(--radius-full)', backgroundColor: 'var(--status-green-bg)', color: 'var(--status-green)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto var(--spacing-4)' }}>
              <CheckCircle size={36} strokeWidth={1.5} />
            </div>
            <h3 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: 'var(--spacing-2)' }}>Day Closed</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9375rem', marginBottom: 'var(--spacing-6)' }}>
              Submitted values: Remaining <strong className="num">{actualRemaining}</strong> glasses &bull; Cash <strong className="num">₹{Number(cashReceived).toLocaleString('en-IN')}</strong> &bull; UPI <strong className="num">₹{Number(upiReceived).toLocaleString('en-IN')}</strong>
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
        ) : step === 1 ? (
          /* Step 1: Actual Remaining Stock */
          <form onSubmit={handleNextStep1}>
            <div className="form-group">
              <label className="form-label" htmlFor="close-remaining">Actual Unsold Stock Remaining (Glasses)</label>
              <input
                id="close-remaining"
                type="number"
                inputMode="numeric"
                className="input-large num"
                placeholder="Counted remaining glasses"
                value={actualRemaining}
                onChange={(e) => setActualRemaining(e.target.value)}
                required
                autoFocus
              />
            </div>
            <button type="submit" className="btn btn-primary" style={{ width: '100%', minHeight: '52px', marginTop: 'var(--spacing-2)' }}>
              Next: Payment Collection
            </button>
          </form>
        ) : step === 2 ? (
          /* Step 2: Cash & UPI Received */
          <form onSubmit={handleNextStep2}>
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

            <button type="submit" className="btn btn-primary" style={{ width: '100%', minHeight: '52px', marginTop: 'var(--spacing-2)' }}>
              Next: Review & Confirm
            </button>
          </form>
        ) : (
          /* Step 3: Read-back & Confirm */
          <div>
            <div className="card" style={{ backgroundColor: 'var(--bg-main)', textAlign: 'center', marginBottom: 'var(--spacing-4)', padding: 'var(--spacing-4)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, color: 'var(--brand-accent)', fontWeight: 700, marginBottom: 'var(--spacing-2)' }}>
                <ShieldCheck size={20} strokeWidth={1.5} />
                <span>VERIFY CLOSING VALUES</span>
              </div>
              <div style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.6 }}>
                Remaining: <span className="num">{actualRemaining}</span> glasses<br />
                Cash Collected: <span className="num">₹{Number(cashReceived).toLocaleString('en-IN')}</span><br />
                UPI Collected: <span className="num">₹{Number(upiReceived).toLocaleString('en-IN')}</span>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 'var(--spacing-2)' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setStep(2)}
                disabled={loading}
              >
                Back
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleFinalSubmit}
                disabled={loading}
              >
                <Check size={20} strokeWidth={1.5} />
                <span>{loading ? 'Closing...' : 'Confirm and Close'}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
