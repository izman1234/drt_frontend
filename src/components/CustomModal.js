import React, { useEffect, useRef } from 'react';
import './CustomModal.css';

/**
 * CustomModal – themed replacement for native alert() and confirm() dialogs.
 *
 * Props:
 *   isOpen      – boolean, whether to show the modal
 *   title       – optional heading text
 *   message     – body text
 *   type        – 'alert' | 'confirm'  (default 'alert')
 *   confirmText – label for the primary button  (default 'OK')
 *   cancelText  – label for the cancel button   (default 'Cancel')
 *   onConfirm   – called when the user clicks the primary button
 *   onCancel    – called when the user clicks cancel / overlay
 */
function CustomModal({
  isOpen,
  title,
  message,
  type = 'alert',
  confirmText = 'OK',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
}) {
  const confirmBtnRef = useRef(null);

  useEffect(() => {
    if (isOpen && confirmBtnRef.current) {
      confirmBtnRef.current.focus();
    }
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') {
        (onCancel || onConfirm)?.();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onCancel, onConfirm]);

  if (!isOpen) return null;

  return (
    <div className="custom-modal-overlay" onMouseDown={type === 'alert' ? onConfirm : onCancel}>
      <div className="custom-modal" onMouseDown={(e) => e.stopPropagation()}>
        {title && <div className="custom-modal-title">{title}</div>}
        <div className="custom-modal-message">{message}</div>
        <div className="custom-modal-buttons">
          {type === 'confirm' && (
            <button className="custom-modal-btn custom-modal-btn-cancel" onClick={onCancel}>
              {cancelText}
            </button>
          )}
          <button
            className="custom-modal-btn custom-modal-btn-confirm"
            onClick={onConfirm}
            ref={confirmBtnRef}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

export default CustomModal;
