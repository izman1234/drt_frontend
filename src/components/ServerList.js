import React, { useState } from 'react';
import './ServerList.css';

function ServerList({ servers, connectedServer, onSelectServer, onAddServer, onRemoveServer, onChangeServerUrl, isConnecting }) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [newServerUrl, setNewServerUrl] = useState('');
  const [addError, setAddError] = useState('');
  const [adding, setAdding] = useState(false);
  const [leaveMenu, setLeaveMenu] = useState(null); // { server, y }
  const [changeIpModal, setChangeIpModal] = useState(null); // { server, ip, port }
  const [changeIpError, setChangeIpError] = useState('');
  const [changingIp, setChangingIp] = useState(false);

  const handleAddServer = async (e) => {
    e.preventDefault();
    setAddError('');

    if (!newServerUrl.trim()) {
      setAddError('Please enter a server address');
      return;
    }

    let url = newServerUrl.trim();

    setAdding(true);
    try {
      await onAddServer(url);
      setNewServerUrl('');
      setShowAddModal(false);
    } catch (err) {
      setAddError(err.message || 'Failed to add server');
    } finally {
      setAdding(false);
    }
  };

  const handleContextMenu = (e, server) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    setLeaveMenu({ server, y: rect.top + rect.height / 2 });
  };

  const handleLeaveConfirm = () => {
    if (leaveMenu) {
      onRemoveServer(leaveMenu.server);
      setLeaveMenu(null);
    }
  };

  const handleOpenChangeIp = (server) => {
    try {
      const parsed = new URL(server.url);
      setChangeIpModal({
        server,
        ip: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? '443' : '80'),
      });
    } catch {
      setChangeIpModal({ server, ip: server.url, port: '' });
    }
    setChangeIpError('');
    setLeaveMenu(null);
  };

  const handleChangeIpSubmit = async (e) => {
    e.preventDefault();
    if (!changeIpModal) return;

    const { server, ip, port } = changeIpModal;
    if (!ip.trim()) {
      setChangeIpError('Please enter an IP address or hostname');
      return;
    }
    if (!port.trim()) {
      setChangeIpError('Please enter a port number');
      return;
    }

    setChangingIp(true);
    try {
      const protocol = new URL(server.url).protocol;
      const newUrl = `${protocol}//${ip.trim()}:${port.trim()}`;
      await onChangeServerUrl(server, newUrl);
      setChangeIpModal(null);
    } catch (err) {
      setChangeIpError(err.message || 'Failed to update server address');
    } finally {
      setChangingIp(false);
    }
  };

  return (
    <div className="server-list-bar">
      {/* ── Server icons + add button ────────────────────── */}
      <div className="server-list-scroll">
        {servers.map(server => (
          <div
            key={server.id}
            className={`server-icon-wrapper ${connectedServer?.id === server.id ? 'active' : ''}`}
            title={server.name || server.url}
          >
            <div className="server-pill" />
            <button
              className={`server-icon ${connectedServer?.id === server.id ? 'active' : ''}`}
              onClick={() => onSelectServer(server)}
              disabled={isConnecting}
              onContextMenu={(e) => handleContextMenu(e, server)}
            >
              {server.icon ? (
                <img src={server.icon} alt={server.name} />
              ) : (
                <span>{(server.name || server.url || '?').charAt(0).toUpperCase()}</span>
              )}
            </button>
          </div>
        ))}

        {/* Add server — sits right after the last server icon */}
        <div className="server-icon-wrapper server-add-wrapper">
          <button
            className="server-add-btn"
            onClick={() => { setShowAddModal(!showAddModal); setAddError(''); }}
            title="Add Server"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M10 4V16M4 10H16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {showAddModal && (
        <>
          <div className="server-add-backdrop" onClick={() => { setShowAddModal(false); setAddError(''); }} />
          <div className="server-add-modal">
            <div className="server-add-modal-content">
              <h3>Add Server</h3>
              <p>Enter the server address to add it to your list.</p>
              {addError && <div className="server-add-error">{addError}</div>}
              <form onSubmit={handleAddServer}>
                <input
                  type="text"
                  placeholder="ip:port"
                  value={newServerUrl}
                  onChange={(e) => setNewServerUrl(e.target.value)}
                  autoFocus
                  disabled={adding}
                />
                <div className="server-add-modal-actions">
                  <button type="button" className="server-add-cancel" onClick={() => { setShowAddModal(false); setAddError(''); }} disabled={adding}>
                    Cancel
                  </button>
                  <button type="submit" className="server-add-confirm" disabled={adding}>
                    {adding ? 'Adding...' : 'Add Server'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </>
      )}

      {leaveMenu && (
        <>
          <div className="leave-menu-backdrop" onClick={() => setLeaveMenu(null)} />
          <div
            className="leave-menu-popover"
            style={{ top: leaveMenu.y }}
          >
            <button className="leave-menu-item change-ip" onClick={() => handleOpenChangeIp(leaveMenu.server)}>
              Change IP
            </button>
            <button className="leave-menu-item" onClick={handleLeaveConfirm}>
              Leave Server
            </button>
          </div>
        </>
      )}

      {changeIpModal && (
        <>
          <div className="server-add-backdrop" onClick={() => setChangeIpModal(null)} />
          <div className="server-add-modal">
            <div className="server-add-modal-content">
              <h3>Change Server Address</h3>
              <p>Update the IP address and port for this server.</p>
              {changeIpError && <div className="server-add-error">{changeIpError}</div>}
              <form onSubmit={handleChangeIpSubmit}>
                <div className="change-ip-fields">
                  <div className="change-ip-field">
                    <label>IP Address / Hostname</label>
                    <input
                      type="text"
                      placeholder="192.168.1.1"
                      value={changeIpModal.ip}
                      onChange={(e) => setChangeIpModal(prev => ({ ...prev, ip: e.target.value }))}
                      autoFocus
                      disabled={changingIp}
                    />
                  </div>
                  <div className="change-ip-field port">
                    <label>Port</label>
                    <input
                      type="text"
                      placeholder="3000"
                      value={changeIpModal.port}
                      onChange={(e) => setChangeIpModal(prev => ({ ...prev, port: e.target.value }))}
                      disabled={changingIp}
                    />
                  </div>
                </div>
                <div className="server-add-modal-actions">
                  <button type="button" className="server-add-cancel" onClick={() => setChangeIpModal(null)} disabled={changingIp}>
                    Cancel
                  </button>
                  <button type="submit" className="server-add-confirm" disabled={changingIp}>
                    {changingIp ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default ServerList;
