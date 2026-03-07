import React from 'react';
import './UserList.css';

function UserList({ users }) {
  const normalizeNameColor = (color) => {
    // Convert old grey default to new purple
    if (color === '#b9bbbe' || color === '#b5bac1') {
      return '#a78bba';
    }
    return color || '#a78bba';
  };

  const onlineUsers = users
    .filter(u => u.status === 'online' || u.status === 'away')
    .sort((a, b) => (a.displayName || a.username).localeCompare(b.displayName || b.username));

  const offlineUsers = users
    .filter(u => u.status === 'offline' || !u.status)
    .sort((a, b) => (a.displayName || a.username).localeCompare(b.displayName || b.username));

  const getInitial = (user) => {
    const name = user.displayName || user.username;
    return name.charAt(0).toUpperCase();
  };

  const getProfilePicture = (user) => {
    // Check backend profile picture first, then fallback to localStorage
    if (user.profilePicture) {
      return user.profilePicture;
    }
    // Fallback to localStorage
    return localStorage.getItem(`profilePicture_${user.id}`) || null;
  };

  const UserAvatar = ({ user }) => {
    const profilePicture = getProfilePicture(user);
    const statusClass = user.status === 'away' ? 'away' : (user.status === 'online' ? 'online' : 'offline');
    return (
      <div className="user-avatar">
        {profilePicture ? (
          <img src={profilePicture} alt={user.displayName || user.username} />
        ) : (
          <div className="user-initial">{getInitial(user)}</div>
        )}
        <div className={`avatar-status-dot ${statusClass}`}></div>
      </div>
    );
  };

  return (
    <aside className="user-sidebar">
      <div className="user-sidebar-header">
        <h3>Members</h3>
      </div>

      {onlineUsers.length > 0 && (
        <div className="user-group">
          <h4>Online ({onlineUsers.length})</h4>
          {onlineUsers.map(user => (
            <div key={user.id} className="user-item online">
              <UserAvatar user={user} />
              <span className="user-name" style={{ color: normalizeNameColor(user.nameColor) }}>{user.displayName || user.username}</span>
            </div>
          ))}
        </div>
      )}

      {offlineUsers.length > 0 && (
        <div className="user-group">
          <h4>Offline ({offlineUsers.length})</h4>
          {offlineUsers.map(user => (
            <div key={user.id} className="user-item offline">
              <UserAvatar user={user} />
              <span className="user-name" style={{ color: normalizeNameColor(user.nameColor) }}>{user.displayName || user.username}</span>
              
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}

export default UserList;
