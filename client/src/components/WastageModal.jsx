import React, { useState } from 'react';
import { api } from '../api';

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
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Record Wastage</h2>
          <button className="btn-close-modal" onClick={onClose}>&times;</button>
        </div>

        {error && <div className="badge badge-danger" style={{ marginBottom: 12, width: '100%' }}>{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" style={{ textAlign: 'center' }}>Quantity (Glasses)</label>
            <div className="stepper-container">
              <button type="button" className="btn-stepper" onClick={handleDecrement}>-</button>
              <div className="stepper-value">{quantity}</div>
              <button type="button" className="btn-stepper" onClick={handleIncrement}>+</button>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Select Reason</label>
            <select
              className="form-select"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            >
              <option value="Spoiled">Spoiled</option>
              <option value="Spilled">Spilled</option>
              <option value="Damaged">Damaged</option>
              <option value="Free sample">Free sample</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <button type="submit" className="btn-submit" disabled={loading}>
            {loading ? 'Submitting...' : 'SUBMIT WASTAGE'}
          </button>
        </form>
      </div>
    </div>
  );
}
