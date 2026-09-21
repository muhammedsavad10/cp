import React, { useState } from 'react';
import { AlertTriangle, Droplet, XCircle, Gift, HelpCircle, X, Minus, Plus, Check } from 'lucide-react';
import { api } from '../api';

const REASONS = [
  { id: 'Spoiled', label: 'Spoiled', icon: AlertTriangle },
  { id: 'Spilled', label: 'Spilled', icon: Droplet },
  { id: 'Damaged', label: 'Damaged', icon: XCircle },
  { id: 'Free sample', label: 'Free sample', icon: Gift },
  { id: 'Other', label: 'Other', icon: HelpCircle }
];

export default function WastageModal({ isOpen, onClose, onSuccess }) {
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState('Spoiled');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleIncrement = () => setQuantity(prev => Math.min(200, prev + 1));
  const handleDecrement = () => setQuantity(prev => Math.max(1, prev - 1));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      await api.submitWastage({ quantity, reason });
      setQuantity(1);
      setReason('Spoiled');
      onSuccess();
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to submit wastage');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="bottom-sheet" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-4)' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 800 }}>Record Wastage</h2>
          <button
            type="button"
            aria-label="Close dialog"
            onClick={onClose}
            className="btn btn-quiet"
            style={{ minHeight: '40px', width: '40px', padding: 0 }}
          >
            <X size={20} strokeWidth={1.5} />
          </button>
        </div>

        {error && (
          <div className="status-pill status-pill-red" style={{ width: '100%', marginBottom: 'var(--spacing-4)', justifyContent: 'center', padding: '10px' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group" style={{ textAlign: 'center' }}>
            <label className="form-label">Quantity (Glasses)</label>
            <div className="stepper-row">
              <button
                type="button"
                className="btn-stepper"
                aria-label="Decrease wastage quantity"
                onClick={handleDecrement}
              >
                <Minus size={24} strokeWidth={1.5} />
              </button>
              <span className="stepper-val num">{quantity}</span>
              <button
                type="button"
                className="btn-stepper"
                aria-label="Increase wastage quantity"
                onClick={handleIncrement}
              >
                <Plus size={24} strokeWidth={1.5} />
              </button>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Select Reason</label>
            <div className="chips-grid">
              {REASONS.map((r) => {
                const IconComponent = r.icon;
                const isSelected = reason === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    className={`chip ${isSelected ? 'chip-selected' : ''}`}
                    onClick={() => setReason(r.id)}
                  >
                    <IconComponent size={18} strokeWidth={1.5} />
                    <span>{r.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', minHeight: '52px', fontSize: '1.0625rem' }}
            disabled={loading}
          >
            <Check size={20} strokeWidth={1.5} />
            <span>{loading ? 'Submitting...' : 'Submit Wastage'}</span>
          </button>
        </form>
      </div>
    </div>
  );
}
