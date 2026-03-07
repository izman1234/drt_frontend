const { app, BrowserWindow, ipcMain, powerMonitor, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs');

const isDev = !app.isPackaged;
let mainWindow;
let idleCheckInterval = null;
const IDLE_THRESHOLD_SECONDS = 30; // 30 seconds of system inactivity

// ── CLI flags ─────────────────────────────────────────────────────────
const argv = process.argv.slice(1);
const FLAG_NO_UPDATE = argv.includes('--no-update');
const FLAG_CHECK_UPDATES = argv.includes('--check-updates');

// ── Updater (lazy-loaded to avoid errors in dev) ──────────────────────
let updater;
try {
  updater = require('./updater');
} catch (e) {
  console.warn('[main] Updater module not available:', e.message);
}

// ── TOFU Certificate Trust Store ──────────────────────────────────────
const tofuStorePath = path.join(app.getPath('userData'), 'trusted-certs.json');
let trustedCerts = {};
try {
  trustedCerts = JSON.parse(fs.readFileSync(tofuStorePath, 'utf8'));
} catch {
  // No existing trust store — start fresh
}

function saveTrustedCerts() {
  try {
    fs.writeFileSync(tofuStorePath, JSON.stringify(trustedCerts, null, 2));
  } catch (e) {
    console.error('Failed to save trusted certs:', e);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false,
    icon: isDev
      ? path.join(__dirname, 'public/images/logo.png')
      : path.join(__dirname, 'build/images/logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  if (isDev) {
    // Development: try dev server, fall back to local build
    const devServerUrl = 'http://localhost:3000';
    mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.on('did-fail-load', () => {
      console.log('Dev server not available, loading from build file');
      mainWindow.loadURL(`file://${path.join(__dirname, 'build/index.html')}`);
    });
  } else {
    // Production: load built files directly
    mainWindow.loadFile(path.join(__dirname, 'build', 'index.html'));
  }

  // Open devtools in development
  if (isDev || process.env.ELECTRON_SHOW_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (idleCheckInterval) clearInterval(idleCheckInterval);
  });

  // Notify renderer when maximize state changes
  mainWindow.on('maximize', () => {
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send('window-maximized');
  });
  mainWindow.on('unmaximize', () => {
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send('window-unmaximized');
  });

  // Start checking system idle time periodically
  if (powerMonitor) {
    idleCheckInterval = setInterval(() => {
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          const idleTime = powerMonitor.getSystemIdleTime();
          mainWindow.webContents.send('system-idle-time', { idleTime, threshold: IDLE_THRESHOLD_SECONDS });
        }
      } catch (e) {
        console.error('Failed to get system idle time:', e);
      }
    }, 5000); // Check every 5 seconds
  }
}

app.on('ready', () => {
  // ── TOFU: Handle self-signed / mismatched certificates ────────────
  // Use setCertificateVerifyProc for reliable cert handling on ALL
  // network requests (XHR, fetch, WebSocket, etc.) — certificate-error
  // only handles some request types reliably.
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    // If Chromium trusts the cert (e.g. real CA), accept immediately
    if (request.verificationResult === 'net::OK') {
      return callback(0); // 0 = trust
    }

    // Self-signed or untrusted cert — apply TOFU logic.
    // DRT servers always use self-signed certificates, so we auto-trust
    // them and keep a fingerprint store for change detection.
    // NOTE: setCertificateVerifyProc only provides hostname (no port).
    try {
      const hostKey = request.hostname;
      const fingerprint = request.certificate ? request.certificate.fingerprint : null;

      if (!fingerprint) {
        return callback(-2); // reject — no cert info
      }

      if (trustedCerts[hostKey]) {
        if (trustedCerts[hostKey] === fingerprint) {
          // Known and unchanged — trust
          return callback(0);
        } else {
          // FINGERPRINT CHANGED — auto-accept but warn the user.
          // Cert changes are expected (server updates, cert regeneration).
          // Hard-blocking would break connectivity; instead we trust the
          // new cert and notify the renderer so it can show a warning.
          const oldFingerprint = trustedCerts[hostKey];
          trustedCerts[hostKey] = fingerprint;
          saveTrustedCerts();
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('tofu-mismatch', {
              hostname: hostKey,
              expected: oldFingerprint,
              got: fingerprint,
              subject: request.certificate.subjectName,
            });
          }
          return callback(0); // trust the new cert
        }
      } else {
        // First contact — Trust On First Use
        trustedCerts[hostKey] = fingerprint;
        saveTrustedCerts();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('tofu-new-cert', {
            hostname: hostKey,
            fingerprint,
            subject: request.certificate ? request.certificate.subjectName : '',
          });
        }
        return callback(0); // trust
      }
    } catch (e) {
      console.error('TOFU cert verify error:', e);
      return callback(-2); // reject on error
    }
  });

  // Keep certificate-error as a fallback for navigation-level requests
  app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
    event.preventDefault();
    try {
      const parsed = new URL(url);
      const hostKey = parsed.hostname;
      const fingerprint = certificate.fingerprint;

      if (trustedCerts[hostKey] && trustedCerts[hostKey] !== fingerprint) {
        // Cert changed — update trust store (same logic as setCertificateVerifyProc)
        trustedCerts[hostKey] = fingerprint;
        saveTrustedCerts();
      } else if (!trustedCerts[hostKey]) {
        // First contact — TOFU
        trustedCerts[hostKey] = fingerprint;
        saveTrustedCerts();
      }
      callback(true); // always trust for DRT servers
    } catch (e) {
      console.error('TOFU cert handler error:', e);
      callback(false);
    }
  });

  createWindow();

  // Trigger update check after window is ready
  if (mainWindow) {
    mainWindow.webContents.once('did-finish-load', () => {
      performAutoUpdateCheck();
    });
  }
});

// ── IPC handlers: Identity backup export / import ─────────────────────
ipcMain.handle('export-backup', async (event, data) => {
  try {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Identity Backup',
      defaultPath: 'drt-identity-backup.json',
      filters: [{ name: 'JSON Files', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { success: false };
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return { success: true, filePath };
  } catch (e) {
    console.error('Export backup error:', e);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('import-backup', async () => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Identity Backup',
      filters: [{ name: 'JSON Files', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths.length) return { success: false };
    const content = fs.readFileSync(filePaths[0], 'utf8');
    return { success: true, data: JSON.parse(content) };
  } catch (e) {
    console.error('Import backup error:', e);
    return { success: false, error: e.message };
  }
});

// ── IPC handlers: TOFU certificate management ─────────────────────────
ipcMain.handle('trust-certificate', async (event, hostname, fingerprint) => {
  trustedCerts[hostname] = fingerprint;
  saveTrustedCerts();
  return { success: true };
});

ipcMain.handle('clear-trusted-cert', async (event, hostname) => {
  delete trustedCerts[hostname];
  saveTrustedCerts();
  return { success: true };
});

ipcMain.handle('get-trusted-certs', async () => {
  return trustedCerts;
});

// ── IPC handlers: Window controls ─────────────────────────────────────
ipcMain.handle('window-minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
});

ipcMain.handle('window-maximize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  }
});

ipcMain.handle('window-close', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
});

// ── IPC handlers: Updater ─────────────────────────────────────────────
ipcMain.handle('get-app-version', () => {
  return updater ? updater.CURRENT_VERSION : require('./package.json').version;
});

ipcMain.handle('get-auto-update-enabled', () => {
  return updater ? updater.getAutoCheckEnabled() : false;
});

ipcMain.handle('set-auto-update-enabled', (event, enabled) => {
  if (updater) updater.setAutoCheckEnabled(enabled);
  return { success: true };
});

ipcMain.handle('check-for-updates', async () => {
  if (!updater) return { error: 'Updater not available' };
  try {
    const info = await updater.checkForUpdates();
    return info ? { update: info } : { upToDate: true };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('download-update', async (event, updateInfo) => {
  if (!updater) return { error: 'Updater not available' };
  try {
    const msiPath = await updater.downloadAndVerifyUpdate(updateInfo, (downloaded, total) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-download-progress', {
          downloaded,
          total,
          percent: Math.round((downloaded / total) * 100),
        });
      }
    });
    return { msiPath };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('install-update', (event, msiPath) => {
  if (!updater) return { error: 'Updater not available' };
  try {
    updater.launchInstallerAndRestart(msiPath);
    return { success: true };
  } catch (e) {
    return { error: e.message };
  }
});

// ── Auto-check for updates on startup ─────────────────────────────────
function performAutoUpdateCheck() {
  if (!updater || FLAG_NO_UPDATE) return;
  if (!FLAG_CHECK_UPDATES && !updater.shouldCheckForUpdates()) return;

  // Delay check by 5 seconds to let the app finish loading
  setTimeout(async () => {
    try {
      const info = await updater.checkForUpdates();
      if (info && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-available', info);
      }
    } catch (e) {
      console.warn('[updater] Auto-check failed:', e.message);
    }
  }, 5000);
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
