import React, { useState, useEffect, useCallback, useRef } from 'react';
import Twemoji from './Twemoji';
import './ToastNotification.css';

let toastIdCounter = 0;
const MAX_VISIBLE = 5;

/**
 * ToastContainer — renders a stack of custom in-app toast notifications
 * in the bottom-right corner, styled to match DRT.
 *
 * Usage: <ToastContainer ref={toastRef} />
 *        toastRef.current.addToast({ title, body, icon, avatar, nameColor, type, onClick })
 */
const ToastContainer = React.forwardRef((_, ref) => {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef({});

  const removeToast = useCallback((id) => {
    // Start exit animation
    setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t));
    // Remove after animation completes
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
      if (timersRef.current[id]) {
        clearTimeout(timersRef.current[id]);
        delete timersRef.current[id];
      }
    }, 300);
  }, []);

  const addToast = useCallback(({ title, body, icon, avatar, nameColor, type = 'message', onClick }) => {
    const id = ++toastIdCounter;
    const toast = { id, title, body, icon, avatar, nameColor, type, onClick, exiting: false };

    setToasts(prev => {
      const next = [...prev, toast];
      // Trim to max visible (remove oldest, non-exiting)
      if (next.filter(t => !t.exiting).length > MAX_VISIBLE) {
        const oldest = next.find(t => !t.exiting);
        if (oldest) {
          return next.map(t => t.id === oldest.id ? { ...t, exiting: true } : t);
        }
      }
      return next;
    });

    // Auto-dismiss after 5 seconds
    timersRef.current[id] = setTimeout(() => removeToast(id), 5000);

    return id;
  }, [removeToast]);

  // Expose addToast via ref
  React.useImperativeHandle(ref, () => ({ addToast, removeToast }), [addToast, removeToast]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      Object.values(timersRef.current).forEach(clearTimeout);
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast-notification toast-${toast.type}${toast.exiting ? ' toast-exit' : ''}`}
          onClick={() => {
            if (toast.onClick) toast.onClick();
            removeToast(toast.id);
          }}
        >
          <div className="toast-icon-area">
            {toast.avatar ? (
              <img className="toast-avatar" src={toast.avatar} alt="" />
            ) : toast.type === 'voice' ? (
              <div className="toast-icon-badge toast-icon-voice"><Twemoji emoji="🔊" size={16} /></div>
            ) : toast.type === 'reaction' ? (
              <div className="toast-icon-badge toast-icon-reaction"><Twemoji emoji="💜" size={16} /></div>
            ) : toast.type === 'mention' ? (
              <div className="toast-icon-badge toast-icon-mention">@</div>
            ) : (
              <div className="toast-icon-badge toast-icon-message"><Twemoji emoji="💬" size={16} /></div>
            )}
          </div>
          <div className="toast-content">
            <div className="toast-title" style={toast.nameColor ? { color: toast.nameColor } : undefined}>
              {toast.title}
            </div>
            <div className="toast-body">{toast.body}</div>
          </div>
          <button
            className="toast-close"
            onClick={(e) => { e.stopPropagation(); removeToast(toast.id); }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
});

ToastContainer.displayName = 'ToastContainer';

export default ToastContainer;
