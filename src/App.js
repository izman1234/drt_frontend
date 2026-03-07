import React, { useState, useEffect } from 'react';
import Auth from './components/Auth';
import Main from './components/Main';
import './App.css';

function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (window.electron && window.electron.onWindowMaximized) {
      window.electron.onWindowMaximized((isMax) => setMaximized(isMax));
    }
  }, []);

  const handleMinimize = () => window.electron?.windowMinimize();
  const handleMaximize = () => window.electron?.windowMaximize();
  const handleClose = () => window.electron?.windowClose();

  return (
    <div className="title-bar">
      <div className="title-bar-drag">
        <span className="title-bar-text">DRT</span>
      </div>
      <div className="title-bar-controls">
        <button className="title-bar-btn" onClick={handleMinimize} title="Minimize">
          <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg>
        </button>
        <button className="title-bar-btn" onClick={handleMaximize} title={maximized ? 'Restore' : 'Maximize'}>
          {maximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 0v2H0v8h8V8h2V0H2zm6 8H1V3h7v5zM9 7V1H3v1h5v5h1z" fill="currentColor"/></svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0" y="0" width="10" height="10" stroke="currentColor" strokeWidth="1" fill="none"/></svg>
          )}
        </button>
        <button className="title-bar-btn title-bar-close" onClick={handleClose} title="Close">
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 0L0 1l4 4-4 4 1 1 4-4 4 4 1-1-4-4 4-4-1-1-4 4z" fill="currentColor"/></svg>
        </button>
      </div>
    </div>
  );
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [identityKeys, setIdentityKeys] = useState(null); // { publicKey, privateKey }

  const handleAuthSuccess = (keys) => {
    setIdentityKeys(keys);
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('userId');
    localStorage.removeItem('username');
    localStorage.removeItem('displayName');
    // Don't remove drt_identity — keep it for next unlock
    setIdentityKeys(null);
    setIsAuthenticated(false);
  };

  return (
    <div className="App">
      <TitleBar />
      <div className="app-content">
        {isAuthenticated ? (
          <Main onLogout={handleLogout} identityKeys={identityKeys} />
        ) : (
          <Auth onAuthSuccess={handleAuthSuccess} />
        )}
      </div>
    </div>
  );
}

export default App;
