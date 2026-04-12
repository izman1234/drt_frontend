import React, { useState, useEffect, useRef, useCallback } from 'react';
import './ProfileModal.css';

function ProfileModal({ isOpen, user, position, onClose }) {
  const [copiedId, setCopiedId] = useState(false);
  const modalRef = useRef(null);

  // Close on click outside (only for positioned/popover mode)
  useEffect(() => {
    if (!isOpen || !position) return;
    const handleMouseDown = (e) => {
      if (modalRef.current && !modalRef.current.contains(e.target)) {
        onClose();
      }
    };
    // Use setTimeout so the opening click doesn't immediately close it
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleMouseDown);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, [isOpen, position, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  // Reset copy state when modal opens/closes
  useEffect(() => {
    if (!isOpen) setCopiedId(false);
  }, [isOpen]);

  // Compute position style
  const getPositionStyle = useCallback(() => {
    if (!position) {
      // Centered (preview from settings) — overlay handles centering
      return {};
    }

    const modalWidth = 340;
    const padding = 8;

    // Anchor top-right corner of modal to top-left corner of the user item
    let left = position.x - modalWidth - padding;
    let top = position.y;

    // Keep within viewport bounds
    if (left < padding) left = padding;
    if (top < padding) top = padding;

    return {
      position: 'fixed',
      top: `${top}px`,
      left: `${left}px`,
    };
  }, [position]);

  if (!isOpen || !user) return null;

  const normalizeNameColor = (color) => {
    if (color === '#b9bbbe' || color === '#b5bac1') return '#a78bba';
    return color || '#a78bba';
  };

  const statusClass = user.status === 'away' ? 'away' : (user.status === 'online' ? 'online' : 'offline');
  const statusLabel = user.status === 'away' ? 'Idle' : (user.status === 'online' ? 'Online' : 'Offline');
  const displayName = user.displayName || user.username;
  const initial = displayName.charAt(0).toUpperCase();

  const handleCopyId = () => {
    const publicId = user.id;
    navigator.clipboard.writeText(publicId).then(() => {
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    }).catch(() => {});
  };

  const isPreview = !position;

  const modal = (
    <div className="profile-modal" ref={modalRef} style={getPositionStyle()}>
      {/* Banner area */}
      <div className="profile-modal-banner">
      </div>

      {/* Avatar overlapping the banner */}
      <div className="profile-modal-avatar-wrapper">
        <div className="profile-modal-avatar">
          {user.profilePicture ? (
            <img src={user.profilePicture} alt={displayName} />
          ) : (
            <div className="profile-modal-avatar-initial">{initial}</div>
          )}
          <div className={`profile-modal-status-dot ${statusClass}`} title={statusLabel}></div>
        </div>
      </div>

      {/* User info card */}
      <div className="profile-modal-info">
        <div className="profile-modal-display-name" style={{ color: normalizeNameColor(user.nameColor) }}>
          {displayName}
        </div>
        <div className="profile-modal-username-row">
          <span className="profile-modal-username">{user.username}</span>
          <span className="profile-modal-separator">•</span>
          <span
            className={`profile-modal-id${copiedId ? ' copied' : ''}`}
            onClick={handleCopyId}
            title={copiedId ? 'Copied!' : 'Click to copy public key'}
          >
            {copiedId ? 'Copied!' : (user.id && user.id.length > 12 ? user.id.slice(0, 6) + '…' + user.id.slice(-6) : user.id)}
          </span>
        </div>

        {user.bio && (
          <>
            <div className="profile-modal-divider" />
            <div className="profile-modal-section-label">About Me</div>
            <div className="profile-modal-bio">{user.bio}</div>
          </>
        )}
      </div>
    </div>
  );

  if (isPreview) {
    return (
      <div className="profile-modal-overlay" onMouseDown={onClose}>
        <div onMouseDown={(e) => e.stopPropagation()}>
          {modal}
        </div>
      </div>
    );
  }

  return modal;
}

export default ProfileModal;
