const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  platform: process.platform,
  nodeVersion: process.version,
  onSystemIdleTime: (callback) => {
    ipcRenderer.on('system-idle-time', (event, data) => {
      callback(data);
    });
  },
  // ── Identity backup export / import ──────────────────────────────
  exportBackup: (data) => ipcRenderer.invoke('export-backup', data),
  importBackup: () => ipcRenderer.invoke('import-backup'),
  // ── TOFU certificate management ──────────────────────────────────
  onTofuNewCert: (callback) => {
    ipcRenderer.on('tofu-new-cert', (event, data) => callback(data));
  },
  onTofuMismatch: (callback) => {
    ipcRenderer.on('tofu-mismatch', (event, data) => callback(data));
  },
  trustCertificate: (hostname, fingerprint) =>
    ipcRenderer.invoke('trust-certificate', hostname, fingerprint),
  clearTrustedCert: (hostname) =>
    ipcRenderer.invoke('clear-trusted-cert', hostname),
  getTrustedCerts: () => ipcRenderer.invoke('get-trusted-certs'),
  // ── Updater ──────────────────────────────────────────────────────
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getAutoUpdateEnabled: () => ipcRenderer.invoke('get-auto-update-enabled'),
  setAutoUpdateEnabled: (enabled) => ipcRenderer.invoke('set-auto-update-enabled', enabled),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: (updateInfo) => ipcRenderer.invoke('download-update', updateInfo),
  installUpdate: (msiPath) => ipcRenderer.invoke('install-update', msiPath),
  onUpdateAvailable: (callback) => {
    ipcRenderer.removeAllListeners('update-available');
    ipcRenderer.on('update-available', (event, data) => callback(data));
  },
  onUpdateDownloadProgress: (callback) => {
    ipcRenderer.on('update-download-progress', (event, data) => callback(data));
  },
  // ── Window controls ──────────────────────────────────────────────
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowClose: () => ipcRenderer.invoke('window-close'),
  onWindowMaximized: (callback) => {
    ipcRenderer.on('window-maximized', () => callback(true));
    ipcRenderer.on('window-unmaximized', () => callback(false));
  },
  // ── Taskbar badge ────────────────────────────────────────────────
  setBadgeCount: (dataURL) => ipcRenderer.invoke('set-badge-count', dataURL),  // ── Pending update info ───────────────────────────────────────
  getPendingUpdate: () => ipcRenderer.invoke('get-pending-update'),});
