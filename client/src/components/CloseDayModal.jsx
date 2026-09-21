import React, { useState } from 'react';
import { ArrowLeft, CheckCircle, X, ShieldCheck } from 'lucide-react';
import { api } from '../api';

export default function CloseDayModal({ isOpen, onClose, onSuccess, soldToday, computedRemaining }) {
  const [step, setStep] = useState(1);
  const [cashReceived, setCashReceived] = useState('');
  const [upiReceived, setUpiReceived] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleNextToVerify = (e) => {
    e.preventDefault();
    if (cashReceived === '' || upiReceived === '') {
      setError('Please enter cash and UPI collected.');
      return;
    }
    setError('');
    setStep(2);
  };

  const handleFinalSubmit = async () => {
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
      setStep(1); // Return to input step on error so worker can re-enter numbers
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setStep(1);
    setCashReceived('');
    setUpiReceived('');
    setSubmitted(false);
    setError('');
    onClose();
  };

  const totalAmountEntered = (Number(cashReceived) || 0) + (Number(upiReceived) || 0);

  return (
    <div className="modal-overlay" onClick={handleReset}>
      <div className="bottom-sheet" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-3)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)' }}>
            {step === 2 && !submitted && (
              <button
                type="button"
                aria-label="Back to step 1"
                onClick={() => setStep(1)}
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
        ) : step === 1 ? (
          /* Step 1: Enter Cash & UPI */
          <form onSubmit={handleNextToVerify}>
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
            >
              Next: Review & Confirm
            </button>
          </form>
        ) : (
          /* Step 2: Read-Back Verification Screen */
          <div>
            <div className="card" style={{ backgroundColor: 'var(--bg-main)', marginBottom: 'var(--spacing-4)', padding: 'var(--spacing-4)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--brand-accent)', fontWeight: 700, marginBottom: 'var(--spacing-3)' }}>
                <ShieldCheck size={20} strokeWidth={1.5} />
                <span>VERIFY CLOSING SUMMARY</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2)', fontSize: '1rem', color: 'var(--text-primary)' }}>
                <div>Total Sold: <strong className="num">{soldToday !== undefined ? soldToday : 0}</strong> glasses</div>
                <div>Total Remaining: <strong className="num">{computedRemaining !== undefined ? computedRemaining : 0}</strong> glasses</div>
                <div>Cash Entered: <strong className="num">₹{Number(cashReceived).toLocaleString('en-IN')}</strong></div>
                <div>UPI Entered: <strong className="num">₹{Number(upiReceived).toLocaleString('en-IN')}</strong></div>
                <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 'var(--spacing-2)', marginTop: 'var(--spacing-1)', fontSize: '1.125rem', fontWeight: 800 }}>
                  Total Amount: <span className="num">₹{totalAmountEntered.toLocaleString('en-IN')}</span>
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 'var(--spacing-2)' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setStep(1)}
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
                {loading ? 'Submitting...' : 'Confirm & Close'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
