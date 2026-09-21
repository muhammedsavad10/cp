import React, { useState, useEffect } from 'react';
import { ArrowLeft, CheckCircle, X, ShieldCheck, AlertTriangle } from 'lucide-react';
import { api } from '../api';

export default function CloseDayModal({ isOpen, onClose, onSuccess, onRefetch, soldToday, computedRemaining }) {
  const [step, setStep] = useState(1);
  const [cashReceived, setCashReceived] = useState('');
  const [upiReceived, setUpiReceived] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mismatchError, setMismatchError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (isOpen && onRefetch) {
      onRefetch();
    }
  }, [isOpen, onRefetch]);

  if (!isOpen) return null;

  const isCashValid = cashReceived.trim() !== '' && !isNaN(cashReceived) && Number(cashReceived) >= 0 && Number.isInteger(Number(cashReceived));
  const isUpiValid = upiReceived.trim() !== '' && !isNaN(upiReceived) && Number(upiReceived) >= 0 && Number.isInteger(Number(upiReceived));
  const canNext = isCashValid && isUpiValid;

  const handleNextToVerify = (e) => {
    e.preventDefault();
    if (!canNext) return;
    setErrorMessage('');
    setMismatchError(false);
    setStep(2);
  };

  const handleFinalSubmit = async (confirmMismatch = false) => {
    setLoading(true);
    setErrorMessage('');

    try {
      await api.closeDay({
        cash_received: Number(cashReceived),
        upi_received: Number(upiReceived),
        confirm_mismatch: confirmMismatch
      });
      setSubmitted(true);
      setMismatchError(false);
      if (onSuccess) onSuccess();
    } catch (err) {
      if (err.code === 'MISMATCH' || (err.message && err.message.includes("doesn't match"))) {
        setMismatchError(true);
        setErrorMessage("Amount doesn't match. Re-check, or close anyway.");
      } else {
        setErrorMessage(err.message || "Failed to submit daily closing.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setStep(1);
    setCashReceived('');
    setUpiReceived('');
    setSubmitted(false);
    setMismatchError(false);
    setErrorMessage('');
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
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800 }}>Close Day</h2>
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

        {errorMessage && !mismatchError && (
          <div className="status-pill status-pill-red" style={{ width: '100%', marginBottom: 'var(--spacing-4)', justifyContent: 'center', padding: '12px', fontSize: '0.9375rem', textAlign: 'center', height: 'auto', borderRadius: 'var(--radius-md)' }}>
            {errorMessage}
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
          /* STEP 1: Close Day Screen */
          <form onSubmit={handleNextToVerify}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-3)', marginBottom: 'var(--spacing-4)' }}>
              <div className="card" style={{ backgroundColor: 'var(--bg-main)', padding: 'var(--spacing-3)', textAlign: 'center' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Glasses Sold Today
                </div>
                <div style={{ fontSize: '1.75rem', fontWeight: 900, color: 'var(--text-primary)', marginTop: '4px' }} className="num">
                  {soldToday !== undefined ? soldToday : 0}
                </div>
              </div>

              <div className="card" style={{ backgroundColor: 'var(--bg-main)', padding: 'var(--spacing-3)', textAlign: 'center' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Glasses Remaining
                </div>
                <div style={{ fontSize: '1.75rem', fontWeight: 900, color: 'var(--text-primary)', marginTop: '4px' }} className="num">
                  {computedRemaining !== undefined ? computedRemaining : 0}
                </div>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="close-upi">UPI Collected (₹)</label>
              <input
                id="close-upi"
                type="number"
                inputMode="numeric"
                className="input-large num"
                placeholder="0"
                value={upiReceived}
                onChange={(e) => setUpiReceived(e.target.value)}
                required
                autoFocus
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="close-cash">Cash Collected (₹)</label>
              <input
                id="close-cash"
                type="number"
                inputMode="numeric"
                className="input-large num"
                placeholder="0"
                value={cashReceived}
                onChange={(e) => setCashReceived(e.target.value)}
                required
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', minHeight: '52px', marginTop: 'var(--spacing-4)' }}
              disabled={!canNext}
            >
              Next
            </button>
          </form>
        ) : (
          /* STEP 2: Verify Modal */
          <div>
            {mismatchError && (
              <div style={{ backgroundColor: '#FEF2F2', border: '1px solid #FCA5A5', color: '#991B1B', borderRadius: 'var(--radius-md)', padding: 'var(--spacing-3)', marginBottom: 'var(--spacing-4)', textAlign: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontWeight: 700, marginBottom: 4 }}>
                  <AlertTriangle size={18} />
                  <span>Mismatch Warning</span>
                </div>
                <p style={{ fontSize: '0.875rem', margin: 0 }}>Amount doesn't match. Re-check, or close anyway.</p>
              </div>
            )}

            <div className="card" style={{ backgroundColor: 'var(--bg-main)', marginBottom: 'var(--spacing-4)', padding: 'var(--spacing-4)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--brand-accent)', fontWeight: 700, marginBottom: 'var(--spacing-3)' }}>
                <ShieldCheck size={20} strokeWidth={1.5} />
                <span>VERIFY CLOSING SUMMARY</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2)', fontSize: '1rem', color: 'var(--text-primary)' }}>
                <div>Total sold today (glasses): <strong className="num">{soldToday !== undefined ? soldToday : 0}</strong></div>
                <div>Remaining today (glasses): <strong className="num">{computedRemaining !== undefined ? computedRemaining : 0}</strong></div>
                <div>Cash in hand: <strong className="num">₹{Number(cashReceived).toLocaleString('en-IN')}</strong></div>
                <div>UPI: <strong className="num">₹{Number(upiReceived).toLocaleString('en-IN')}</strong></div>
                <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 'var(--spacing-2)', marginTop: 'var(--spacing-1)', fontSize: '1.125rem', fontWeight: 800 }}>
                  Total amount: <span className="num">₹{totalAmountEntered.toLocaleString('en-IN')}</span>
                </div>
              </div>
            </div>

            {mismatchError ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-2)' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => { setMismatchError(false); setStep(1); }}
                  disabled={loading}
                >
                  Re-check / Edit
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => handleFinalSubmit(true)}
                  disabled={loading}
                  style={{ backgroundColor: '#DC2626', borderColor: '#DC2626' }}
                >
                  {loading ? 'Closing...' : 'Close Anyway'}
                </button>
              </div>
            ) : (
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
                  onClick={() => handleFinalSubmit(false)}
                  disabled={loading}
                >
                  {loading ? 'Submitting...' : 'Verify & continue'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
