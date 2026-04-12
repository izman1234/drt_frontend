import React, { useState, useEffect } from 'react';
import { identityAPI, setServerUrl, resolveServerUrl } from '../api';
import {
  ensureReady,
  createIdentity,
  unlockIdentity,
  recoverWithSeed,
  restoreFromBackup,
  signChallenge,
  deriveFromRecoveryKey,
  isValidRecoveryKey,
} from '../crypto';
import Twemoji from './Twemoji';
import './Auth.css';

/**
 * Auth component — Multi-step wizard for cryptographic identity management.
 *
 * Steps:
 *   loading          → checking for existing local identity
 *   account-picker   → list of saved accounts on this device
 *   create           → new identity: username, displayName, password
 *   seed-display     → show recovery key
 *   seed-confirm     → verify key (enter last 5 chars) → go to main app
 *   unlock           → returning user: enter password → go to main app
 *   forgot-password  → enter recovery key
 *   set-new-password → set new password after recovery → go to main app
 *   restore-choice   → restore from file or server
 *   restore-file     → file import + recovery key + new password → go to main app
 *
 * Server connection is now handled in Main.js via the server list sidebar.
 */

// ── Multi-account helpers ──────────────────────────────────────────────
function getSavedAccounts() {
  try {
    return JSON.parse(localStorage.getItem('drt_accounts')) || [];
  } catch { return []; }
}

function saveAccountToList(username, displayName, identityData) {
  const accounts = getSavedAccounts();
  const pubKey = identityData.identityPublicKey;
  const idx = accounts.findIndex(a => a.identityData?.identityPublicKey === pubKey);
  const entry = { username, displayName, identityData };
  if (idx >= 0) {
    accounts[idx] = entry;
  } else {
    accounts.push(entry);
  }
  localStorage.setItem('drt_accounts', JSON.stringify(accounts));
}

function removeAccountFromList(pubKey) {
  const accounts = getSavedAccounts().filter(a => a.identityData?.identityPublicKey !== pubKey);
  localStorage.setItem('drt_accounts', JSON.stringify(accounts));
}

function setActiveAccount(username, displayName, identityData) {
  localStorage.setItem('drt_identity', JSON.stringify(identityData));
  localStorage.setItem('drt_username', username);
  localStorage.setItem('drt_displayName', displayName);
  saveAccountToList(username, displayName, identityData);
}

function Auth({ onAuthSuccess }) {
  const [step, setStep] = useState('loading');
  const [identityData, setIdentityData] = useState(null);
  const [, setKeys] = useState(null); // { publicKey, privateKey }
  const [recoverySeed, setRecoverySeed] = useState('');
  const [seedConfirmWord, setSeedConfirmWord] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [seedCountdown, setSeedCountdown] = useState(10);
  const [savedAccounts, setSavedAccounts] = useState([]);

  // Form data
  const [createForm, setCreateForm] = useState({
    username: '', displayName: '', password: '', confirmPassword: '',
  });
  const [unlockPassword, setUnlockPassword] = useState('');
  const [recoveryInput, setRecoveryInput] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');


  // ── Initialize ──────────────────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      try {
        await ensureReady();

        const legacyIdentity = localStorage.getItem('drt_identity');
        if (legacyIdentity) {
          const data = JSON.parse(legacyIdentity);
          setIdentityData(data);
          setSavedAccounts(getSavedAccounts());
          setStep('unlock');
        } else {
          const accounts = getSavedAccounts();
          setSavedAccounts(accounts);
          if (accounts.length > 0) {
            setStep('account-picker');
          } else {
            setStep('create');
          }
        }
      } catch (e) {
        console.error('Init error:', e);
        setStep('create');
      }
    };
    init();
  }, []);

  // ── TOFU certificate warning listener ───────────────────────────────
  useEffect(() => {
    if (window.electron && window.electron.onTofuMismatch) {
      window.electron.onTofuMismatch((data) => {
        setError(`SECURITY WARNING: Server certificate for ${data.hostname} has changed! Expected fingerprint: ${data.expected.substring(0, 20)}... Got: ${data.got.substring(0, 20)}... Connection blocked. If this is expected (server reinstalled), you can update the trust in Settings.`);
      });
    }
    if (window.electron && window.electron.onTofuNewCert) {
      window.electron.onTofuNewCert((data) => {
        console.log(`TOFU: Trusted new certificate for ${data.hostname} (fingerprint: ${data.fingerprint})`);
      });
    }
  }, []);

  // ── Countdown for seed display ──────────────────────────────────────
  useEffect(() => {
    if (step === 'seed-display' && seedCountdown > 0) {
      const timer = setTimeout(() => setSeedCountdown(c => c - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [step, seedCountdown]);

  // ── Step: CREATE — generate new identity ────────────────────────────
  const handleCreate = async (e) => {
    e.preventDefault();
    setError('');
    const { username, displayName, password, confirmPassword } = createForm;

    if (!username || !displayName || !password) {
      return setError('All fields are required');
    }
    if (password.length < 6) {
      return setError('Password must be at least 6 characters');
    }
    if (password !== confirmPassword) {
      return setError('Passwords do not match');
    }

    setLoading(true);
    try {
      const result = await createIdentity(password);
      setIdentityData(result.identityData);
      setRecoverySeed(result.recoveryKey);
      setActiveAccount(username, displayName, result.identityData);
      setSavedAccounts(getSavedAccounts());
      setSeedCountdown(10);
      setStep('seed-display');
    } catch (err) {
      setError('Failed to create identity: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Step: SEED-CONFIRM — verify user saved the key ─────────────────
  const handleSeedConfirm = async (e) => {
    e.preventDefault();
    setError('');
    const last5 = recoverySeed.replace(/[^0-9A-Za-z]/g, '').slice(-5).toUpperCase();
    if (seedConfirmWord.trim().toUpperCase() !== last5) {
      return setError('Incorrect. Please enter the last 5 characters of your recovery key.');
    }
    // Unlock identity to get keys, then proceed to main app
    setLoading(true);
    try {
      const stored = JSON.parse(localStorage.getItem('drt_identity'));
      const unlocked = await unlockIdentity(stored, createForm.password);
      setKeys(unlocked);
      onAuthSuccess(unlocked);
    } catch (err) {
      setError('Failed to unlock identity: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Step: UNLOCK — decrypt existing identity ────────────────────────
  const handleUnlock = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const unlocked = await unlockIdentity(identityData, unlockPassword);
      setKeys(unlocked);
      onAuthSuccess(unlocked);
    } catch (err) {
      setError(err.message || 'Failed to unlock identity');
    } finally {
      setLoading(false);
    }
  };

  // ── Step: FORGOT-PASSWORD — enter recovery seed ─────────────────────
  const handleRecoverySubmit = (e) => {
    e.preventDefault();
    setError('');
    const trimmed = recoveryInput.trim();
    if (!isValidRecoveryKey(trimmed)) {
      return setError('Invalid recovery key. Please enter your full recovery key (starts with DRT-).');
    }
    setStep('set-new-password');
  };

  // ── Step: SET-NEW-PASSWORD — reset password with recovery seed ──────
  const handleSetNewPassword = async (e) => {
    e.preventDefault();
    setError('');
    if (newPassword.length < 6) {
      return setError('Password must be at least 6 characters');
    }
    if (newPassword !== confirmNewPassword) {
      return setError('Passwords do not match');
    }
    setLoading(true);
    try {
      const result = await recoverWithSeed(identityData, recoveryInput.trim(), newPassword);
      setIdentityData(result.updatedIdentityData);
      setKeys({ publicKey: result.publicKey, privateKey: result.privateKey });
      localStorage.setItem('drt_identity', JSON.stringify(result.updatedIdentityData));
      saveAccountToList(
        localStorage.getItem('drt_username') || '',
        localStorage.getItem('drt_displayName') || '',
        result.updatedIdentityData
      );
      setSuccessMessage('Password reset successfully! Your identity is unchanged.');
      
      const restoredKeys = { publicKey: result.publicKey, privateKey: result.privateKey };
      setTimeout(() => onAuthSuccess(restoredKeys), 1000);
    } catch (err) {
      setError(err.message || 'Recovery failed');
    } finally {
      setLoading(false);
    }
  };

  // ── Step: RESTORE (file) — import backup + recovery seed ────────────
  const handleRestoreFile = async () => {
    setError('');
    try {
      let backupData;
      if (window.electron && window.electron.importBackup) {
        const result = await window.electron.importBackup();
        if (!result.success) return;
        backupData = result.data;
      } else {
        // Fallback: file input
        return setError('File import requires the desktop app');
      }
      setStep('restore-file');
      localStorage.setItem('drt_pending_backup', JSON.stringify(backupData));
    } catch (err) {
      setError('Failed to import backup: ' + err.message);
    }
  };

  const handleRestoreFromBackup = async (e) => {
    e.preventDefault();
    setError('');
    if (newPassword.length < 6) {
      return setError('Password must be at least 6 characters');
    }
    if (newPassword !== confirmNewPassword) {
      return setError('Passwords do not match');
    }
    if (!isValidRecoveryKey(recoveryInput.trim())) {
      return setError('Invalid recovery key');
    }
    setLoading(true);
    try {
      const backup = JSON.parse(localStorage.getItem('drt_pending_backup'));
      const result = await restoreFromBackup(backup, recoveryInput.trim(), newPassword);
      setIdentityData(result.identityData);
      setKeys({ publicKey: result.publicKey, privateKey: result.privateKey });
      localStorage.setItem('drt_identity', JSON.stringify(result.identityData));
      saveAccountToList(
        localStorage.getItem('drt_username') || '',
        localStorage.getItem('drt_displayName') || '',
        result.identityData
      );
      localStorage.removeItem('drt_pending_backup');
      setSuccessMessage('Identity restored from backup!');
      const restoredKeys = { publicKey: result.publicKey, privateKey: result.privateKey };
      setTimeout(() => onAuthSuccess(restoredKeys), 1000);
    } catch (err) {
      setError(err.message || 'Restore failed');
    } finally {
      setLoading(false);
    }
  };

  // ── Go to account picker (or create if no accounts) ────────────────
  const handleSwitchAccount = () => {
    // Clear the active identity in memory, but keep localStorage for the picker
    setIdentityData(null);
    setKeys(null);
    setError('');
    const accounts = getSavedAccounts();
    setSavedAccounts(accounts);
    if (accounts.length > 0) {
      setStep('account-picker');
    } else {
      setStep('create');
    }
  };

  // ── Select a saved account from the picker ──────────────────────────
  const handleSelectAccount = (account) => {
    setActiveAccount(account.username, account.displayName, account.identityData);
    setIdentityData(account.identityData);
    setKeys(null);
    setUnlockPassword('');
    setError('');
    setStep('unlock');
  };

  // ── Remove an account from the saved list ───────────────────────────
  const handleRemoveAccount = (account) => {
    const pubKey = account.identityData?.identityPublicKey;
    removeAccountFromList(pubKey);
    // If this was the active account, clear it
    const activeIdentity = localStorage.getItem('drt_identity');
    if (activeIdentity) {
      try {
        const active = JSON.parse(activeIdentity);
        if (active.identityPublicKey === pubKey) {
          localStorage.removeItem('drt_identity');
          localStorage.removeItem('drt_username');
          localStorage.removeItem('drt_displayName');
        }
      } catch {}
    }
    const remaining = getSavedAccounts();
    setSavedAccounts(remaining);
    if (remaining.length === 0) {
      setIdentityData(null);
      setStep('create');
    }
  };

  return (
    <div className="auth-container">
      {/* ── LOADING ──────────────────────────────────────────────── */}
      {step === 'loading' && (
        <div className="auth-box">
          <h1>Loading...</h1>
          <p className="auth-subtitle">Initializing cryptographic library</p>
        </div>
      )}

      {/* ── ACCOUNT PICKER ───────────────────────────────────────── */}
      {step === 'account-picker' && (
        <div className="auth-box auth-box-wide">
          <h1>Choose Account</h1>
          <p className="auth-subtitle">
            Select an account to sign in, or create a new one.
          </p>
          {error && <div className="error-message">{error}</div>}

          <div className="account-list">
            {savedAccounts.map((account, idx) => (
              <div key={account.identityData?.identityPublicKey || idx} className="account-item">
                <button
                  type="button"
                  className="account-select-btn"
                  onClick={() => handleSelectAccount(account)}
                >
                  <div className="account-avatar">
                    {(account.displayName || account.username || '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="account-info">
                    <span className="account-display-name">{account.displayName || account.username}</span>
                    {account.displayName && account.displayName !== account.username && (
                      <span className="account-username">@{account.username}</span>
                    )}
                  </div>
                </button>
                <button
                  type="button"
                  className="account-remove-btn"
                  onClick={() => handleRemoveAccount(account)}
                  title="Remove from this device"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <div className="auth-links">
            <button type="button" className="link-btn" onClick={() => { setError(''); setStep('create'); }}>
              Create New Identity
            </button>
            <button type="button" className="link-btn" onClick={() => { setError(''); setStep('restore-choice'); }}>
              Restore from Backup
            </button>
          </div>
        </div>
      )}

      {/* ── CREATE IDENTITY ──────────────────────────────────────── */}
      {step === 'create' && (
        <div className="auth-box">
          <h1>Create Identity</h1>
          <p className="auth-subtitle">
            Your identity is a cryptographic keypair stored locally.
            Your password only unlocks it on this device — it is never sent to any server.
          </p>
          {error && <div className="error-message">{error}</div>}

          <form onSubmit={handleCreate}>
            <input type="text" placeholder="Username" value={createForm.username}
              onChange={(e) => setCreateForm(f => ({ ...f, username: e.target.value }))} required autoComplete="off" />
            <input type="text" placeholder="Display Name" value={createForm.displayName}
              onChange={(e) => setCreateForm(f => ({ ...f, displayName: e.target.value }))} required autoComplete="off" />
            <input type="password" placeholder="Local Password" value={createForm.password}
              onChange={(e) => setCreateForm(f => ({ ...f, password: e.target.value }))} required />
            <input type="password" placeholder="Confirm Password" value={createForm.confirmPassword}
              onChange={(e) => setCreateForm(f => ({ ...f, confirmPassword: e.target.value }))} required />
            <button type="submit" disabled={loading}>
              {loading ? 'Generating keypair...' : 'Create Identity'}
            </button>
          </form>

          <div className="auth-links">
            {savedAccounts.length > 0 && (
              <button type="button" className="link-btn" onClick={() => setStep('account-picker')}>
                Back to saved accounts
              </button>
            )}
            <button type="button" className="link-btn" onClick={() => setStep('restore-choice')}>
              Restore from Backup
            </button>
          </div>
        </div>
      )}

      {/* ── RECOVERY KEY DISPLAY ─────────────────────────────────── */}
      {step === 'seed-display' && (
        <div className="auth-box auth-box-wide">
          <h1>Recovery Key</h1>
          <div className="seed-warning">
            <Twemoji emoji="⚠️" size={16} /> Copy this recovery key and keep it safe. This is the ONLY way to recover
            your identity if you forget your password or lose this device.
            <strong> If you lose both your password AND this key, your identity cannot be recovered.</strong>
          </div>

          <div className="recovery-key-display" onClick={() => {
            navigator.clipboard.writeText(recoverySeed);
          }}>
            <code className="recovery-key-text">{recoverySeed}</code>
            <span className="recovery-key-copy-hint">Click to copy</span>
          </div>

          <button
            onClick={() => setStep('seed-confirm')}
            disabled={seedCountdown > 0}
            className="seed-continue-btn"
          >
            {seedCountdown > 0
              ? `I have saved my recovery key (${seedCountdown}s)`
              : 'I have saved my recovery key'}
          </button>
        </div>
      )}

      {/* ── RECOVERY KEY CONFIRM ──────────────────────────────────── */}
      {step === 'seed-confirm' && (
        <div className="auth-box">
          <h1>Confirm Recovery Key</h1>
          <p className="auth-subtitle">
            Enter the <strong>last 5 characters</strong> of your recovery key to confirm you saved it (not counting dashes).
          </p>
          {error && <div className="error-message">{error}</div>}

          <form onSubmit={handleSeedConfirm}>
            <input
              type="text"
              placeholder="Last 5 characters"
              value={seedConfirmWord}
              onChange={(e) => setSeedConfirmWord(e.target.value)}
              required
              autoComplete="off"
              maxLength={5}
              style={{ textTransform: 'uppercase', letterSpacing: '2px', textAlign: 'center' }}
            />
            <button type="submit">Confirm</button>
          </form>
        </div>
      )}

      {/* ── UNLOCK ───────────────────────────────────────────────── */}
      {step === 'unlock' && (
        <div className="auth-box">
          <h1>Welcome Back{localStorage.getItem('drt_username') ? `, ${localStorage.getItem('drt_username')}` : ''}!</h1>
          <p className="auth-subtitle">
            Enter your local password to unlock your identity.
          </p>
          {error && <div className="error-message">{error}</div>}
          {successMessage && <div className="success-message">{successMessage}</div>}

          <form onSubmit={handleUnlock}>
            <input
              type="password"
              placeholder="Local Password"
              value={unlockPassword}
              onChange={(e) => setUnlockPassword(e.target.value)}
              required
            />
            <button type="submit" disabled={loading}>
              {loading ? 'Unlocking...' : 'Unlock'}
            </button>
          </form>

          <div className="auth-links">
            <button type="button" className="link-btn" onClick={() => setStep('forgot-password')}>
              Forgot Password?
            </button>
            <button type="button" className="link-btn danger" onClick={handleSwitchAccount}>
              Use Different Account
            </button>
          </div>
        </div>
      )}

      {/* ── FORGOT PASSWORD ──────────────────────────────────────── */}
      {step === 'forgot-password' && (
        <div className="auth-box">
          <h1>Recover Identity</h1>
          <p className="auth-subtitle">
            Enter your recovery key to reset your password.
            Your identity (public key) will remain unchanged.
          </p>
          {error && <div className="error-message">{error}</div>}

          <form onSubmit={handleRecoverySubmit}>
            <input
              type="text"
              placeholder="DRT-XXXXX-XXXXX-..."
              value={recoveryInput}
              onChange={(e) => setRecoveryInput(e.target.value)}
              required
              className="recovery-key-input"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="submit">Continue</button>
          </form>

          <button type="button" className="back-button" onClick={() => setStep('unlock')}>
            Back
          </button>
        </div>
      )}

      {/* ── SET NEW PASSWORD ─────────────────────────────────────── */}
      {step === 'set-new-password' && (
        <div className="auth-box">
          <h1>Set New Password</h1>
          {error && <div className="error-message">{error}</div>}
          {successMessage && <div className="success-message">{successMessage}</div>}

          <form onSubmit={handleSetNewPassword}>
            <input type="password" placeholder="New Password" value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)} required />
            <input type="password" placeholder="Confirm New Password" value={confirmNewPassword}
              onChange={(e) => setConfirmNewPassword(e.target.value)} required />
            <button type="submit" disabled={loading}>
              {loading ? 'Resetting...' : 'Reset Password'}
            </button>
          </form>
        </div>
      )}

      {/* ── RESTORE CHOICE ───────────────────────────────────────── */}
      {step === 'restore-choice' && (
        <div className="auth-box">
          <h1>Restore Identity</h1>
          <p className="auth-subtitle">Choose how to restore your identity:</p>
          {error && <div className="error-message">{error}</div>}

          <div className="restore-options">
            <button className="restore-option-btn" onClick={handleRestoreFile}>
              <Twemoji emoji="📁" size={16} /> Import Backup File
              <span className="restore-option-desc">If you exported a backup previously</span>
            </button>
            <button className="restore-option-btn" onClick={() => setStep('restore-server')}>
              <Twemoji emoji="🌐" size={16} /> Download from Server
              <span className="restore-option-desc">If your backup was uploaded to a server</span>
            </button>
          </div>

          <button type="button" className="back-button" onClick={() => setStep(savedAccounts.length > 0 ? 'account-picker' : 'create')}>
            Back
          </button>
        </div>
      )}

      {/* ── RESTORE FROM FILE ────────────────────────────────────── */}
      {step === 'restore-file' && (
        <div className="auth-box">
          <h1>Restore from Backup</h1>
          <p className="auth-subtitle">
            Enter your recovery key and choose a new password.
          </p>
          {error && <div className="error-message">{error}</div>}
          {successMessage && <div className="success-message">{successMessage}</div>}

          <form onSubmit={handleRestoreFromBackup}>
            <input
              type="text"
              placeholder="DRT-XXXXX-XXXXX-..."
              value={recoveryInput}
              onChange={(e) => setRecoveryInput(e.target.value)}
              required
              className="recovery-key-input"
              autoComplete="off"
              spellCheck={false}
            />
            <input type="password" placeholder="New Password" value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)} required />
            <input type="password" placeholder="Confirm Password" value={confirmNewPassword}
              onChange={(e) => setConfirmNewPassword(e.target.value)} required />
            <button type="submit" disabled={loading}>
              {loading ? 'Restoring...' : 'Restore Identity'}
            </button>
          </form>

          <button type="button" className="back-button" onClick={() => setStep('restore-choice')}>
            Back
          </button>
        </div>
      )}

      {/* ── RESTORE FROM SERVER ──────────────────────────────────── */}
      {step === 'restore-server' && (
        <RestoreFromServer
          error={error}
          setError={setError}
          setIdentityData={setIdentityData}
          setKeys={setKeys}
          setStep={setStep}
          setSuccessMessage={setSuccessMessage}
          onAuthSuccess={onAuthSuccess}
        />
      )}

    </div>
  );
}

// ── Sub-component: Restore from server backup blob ────────────────────
function RestoreFromServer({ error, setError, setIdentityData, setKeys, setStep, setSuccessMessage, onAuthSuccess }) {
  const [serverUrl, setServerUrlLocal] = useState('');
  const [username, setUsername] = useState('');
  const [recoverySeed, setRecoverySeed] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!isValidRecoveryKey(recoverySeed.trim())) {
      return setError('Invalid recovery key');
    }
    if (newPwd.length < 6) return setError('Password must be at least 6 characters');
    if (newPwd !== confirmPwd) return setError('Passwords do not match');

    setLoading(true);
    try {
      // Resolve the best reachable URL (HTTPS first, then HTTP)
      let url;
      try {
        const resolved = await resolveServerUrl(serverUrl.trim());
        url = resolved.url;
      } catch {
        throw new Error(`Cannot reach server at ${serverUrl.trim()}`);
      }
      setServerUrl(url);

      // Derive recovery keypair from key
      const { recoveryPrivateKey } = await deriveFromRecoveryKey(recoverySeed.trim());

      // Request a recovery challenge
      const challengeRes = (await identityAPI.challenge({ username, type: 'recovery' })).data;
      const signature = await signChallenge(challengeRes.challenge, recoveryPrivateKey);

      // Download backup blob
      const blobRes = (await identityAPI.downloadBackupBlob({ username, challengeId: challengeRes.challengeId, signature })).data;

      if (!blobRes.blob) throw new Error('No backup blob found on server');

      // Restore from backup
      const result = await restoreFromBackup(blobRes.blob, recoverySeed.trim(), newPwd);
      setIdentityData(result.identityData);
      setKeys({ publicKey: result.publicKey, privateKey: result.privateKey });
      setActiveAccount(username, username, result.identityData);
      setSuccessMessage('Identity restored from server backup!');
      const restoredKeys = { publicKey: result.publicKey, privateKey: result.privateKey };
      setTimeout(() => onAuthSuccess(restoredKeys), 1000);
    } catch (err) {
      setError(err.message || 'Server restore failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-box">
      <h1>Restore from Server</h1>
      <p className="auth-subtitle">
        Enter the server address, your username, and recovery key to download and decrypt your backup.
      </p>
      {error && <div className="error-message">{error}</div>}

      <form onSubmit={handleSubmit}>
        <input type="text" placeholder="ip:port" value={serverUrl}
          onChange={(e) => setServerUrlLocal(e.target.value)} required />
        <input type="text" placeholder="Username" value={username}
          onChange={(e) => setUsername(e.target.value)} required autoComplete="off" />
        <input type="text" placeholder="DRT-XXXXX-XXXXX-..." value={recoverySeed}
          onChange={(e) => setRecoverySeed(e.target.value)} required className="recovery-key-input"
          autoComplete="off" spellCheck={false} />
        <input type="password" placeholder="New Password" value={newPwd}
          onChange={(e) => setNewPwd(e.target.value)} required />
        <input type="password" placeholder="Confirm Password" value={confirmPwd}
          onChange={(e) => setConfirmPwd(e.target.value)} required />
        <button type="submit" disabled={loading}>
          {loading ? 'Restoring...' : 'Download & Restore'}
        </button>
      </form>

      <button type="button" className="back-button" onClick={() => setStep('restore-choice')}>
        Back
      </button>
    </div>
  );
}

export default Auth;
