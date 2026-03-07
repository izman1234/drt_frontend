// ── DRT Auto-Updater ──────────────────────────────────────────────────
// Checks GitHub Releases for new versions and handles download + install.
// Works with MSI installers produced by electron-builder.

const { app, dialog } = require('electron');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

// ── Configuration ─────────────────────────────────────────────────────
const pkg = require('./package.json');
const CURRENT_VERSION = pkg.version;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Parse owner/repo from package.json repository URL
function getRepoInfo() {
  const repoUrl = pkg.repository && (typeof pkg.repository === 'string' ? pkg.repository : pkg.repository.url);
  if (!repoUrl) return { owner: 'OWNER', repo: 'REPO' };
  const match = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
  if (match) return { owner: match[1], repo: match[2] };
  return { owner: 'OWNER', repo: 'REPO' };
}

const { owner: REPO_OWNER, repo: REPO_NAME } = getRepoInfo();

// ── Persistence ───────────────────────────────────────────────────────
function getUpdateStatePath() {
  return path.join(app.getPath('userData'), 'update-state.json');
}

function readUpdateState() {
  try {
    return JSON.parse(fs.readFileSync(getUpdateStatePath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeUpdateState(patch) {
  const current = readUpdateState();
  const merged = { ...current, ...patch };
  try {
    fs.writeFileSync(getUpdateStatePath(), JSON.stringify(merged, null, 2));
  } catch (e) {
    console.error('[updater] Failed to write update state:', e.message);
  }
}

function getAutoCheckEnabled() {
  return readUpdateState().autoCheckEnabled !== false; // default ON
}

function setAutoCheckEnabled(enabled) {
  writeUpdateState({ autoCheckEnabled: !!enabled });
}

function shouldCheckForUpdates() {
  if (!getAutoCheckEnabled()) return false;
  const state = readUpdateState();
  if (!state.lastCheckTimestamp) return true;
  return (Date.now() - state.lastCheckTimestamp) >= CHECK_INTERVAL_MS;
}

// ── Version comparison (semver-like) ──────────────────────────────────
function compareVersions(v1, v2) {
  const a = v1.replace(/^v/, '').split('.').map(Number);
  const b = v2.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

// ── HTTPS helpers ─────────────────────────────────────────────────────
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const opts = {
      headers: {
        'User-Agent': `DRT-Desktop/${CURRENT_VERSION}`,
        'Accept': 'application/vnd.github+json',
      },
    };
    https.get(url, opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsGet(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const opts = {
      headers: { 'User-Agent': `DRT-Desktop/${CURRENT_VERSION}` },
    };
    https.get(url, opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFile(res.headers.location, destPath, onProgress).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const totalSize = parseInt(res.headers['content-length'], 10) || 0;
      let downloaded = 0;
      const file = fs.createWriteStream(destPath);
      res.on('data', (chunk) => {
        downloaded += chunk.length;
        if (onProgress && totalSize) {
          onProgress(downloaded, totalSize);
        }
      });
      res.pipe(file);
      file.on('finish', () => { file.close(resolve); });
      file.on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
      res.on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    }).on('error', reject);
  });
}

// ── Check for updates ─────────────────────────────────────────────────
async function checkForUpdates() {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
  const data = await httpsGet(url);
  const release = JSON.parse(data.toString('utf8'));

  writeUpdateState({ lastCheckTimestamp: Date.now() });

  const latestVersion = release.tag_name.replace(/^v/, '');

  // Prevent downgrades — only offer genuinely newer versions
  if (compareVersions(latestVersion, CURRENT_VERSION) <= 0) {
    return null; // up-to-date
  }

  // Locate MSI and checksum assets
  const msiAsset = release.assets.find((a) => a.name.endsWith('.msi'));
  const checksumAsset = release.assets.find((a) => a.name.endsWith('.msi.sha256'));

  if (!msiAsset) {
    throw new Error('No MSI installer found in the latest release.');
  }

  return {
    version: latestVersion,
    currentVersion: CURRENT_VERSION,
    releaseNotes: release.body || '',
    releaseName: release.name || `v${latestVersion}`,
    msiUrl: msiAsset.browser_download_url,
    msiName: msiAsset.name,
    msiSize: msiAsset.size,
    checksumUrl: checksumAsset ? checksumAsset.browser_download_url : null,
    htmlUrl: release.html_url,
  };
}

// ── Download + verify ─────────────────────────────────────────────────
async function downloadAndVerifyUpdate(updateInfo, onProgress) {
  const tempDir = path.join(app.getPath('temp'), 'drt-update');
  fs.mkdirSync(tempDir, { recursive: true });

  const msiPath = path.join(tempDir, updateInfo.msiName);

  // Download MSI
  await downloadFile(updateInfo.msiUrl, msiPath, onProgress);

  // Verify SHA256 checksum
  if (updateInfo.checksumUrl) {
    const checksumData = await httpsGet(updateInfo.checksumUrl);
    const checksumLine = checksumData.toString('utf8').trim();
    const expectedHash = checksumLine.split(/\s+/)[0].toLowerCase();

    const fileBuffer = fs.readFileSync(msiPath);
    const actualHash = crypto.createHash('sha256').update(fileBuffer).digest('hex').toLowerCase();

    if (actualHash !== expectedHash) {
      fs.unlinkSync(msiPath);
      throw new Error(
        `SHA256 verification failed!\nExpected: ${expectedHash}\nActual:   ${actualHash}\n\nThe downloaded file may have been tampered with.`
      );
    }
    console.log('[updater] SHA256 verified OK');
  } else {
    console.warn('[updater] No checksum file found — skipping SHA256 verification');
  }

  return msiPath;
}

// ── Launch MSI installer & restart ────────────────────────────────────
// Creates a helper script that:
//   1. Waits for the app to exit
//   2. Runs the MSI installer (passive mode — progress bar only)
//   3. Re-launches the app
//   4. Cleans up
function launchInstallerAndRestart(msiPath) {
  const appExePath = app.getPath('exe');
  const scriptDir = path.dirname(msiPath);
  const scriptPath = path.join(scriptDir, 'drt-update.ps1');
  const logPath = path.join(scriptDir, 'drt-update.log');

  // Use single-quoted strings in PowerShell — they are literal,
  // so backslashes are just backslashes (no escaping needed).
  const script = [
    '# DRT Updater Script',
    `$logFile = '${logPath}'`,
    `$msiPath = '${msiPath}'`,
    `$appExe  = '${appExePath}'`,
    '',
    'function Log($msg) { "$(Get-Date -f o) $msg" | Out-File -Append $logFile }',
    '',
    'Log "Updater started, waiting for app to exit..."',
    'Start-Sleep -Seconds 3',
    '',
    'try {',
    '    Log "Starting MSI install: $msiPath"',
    '    Start-Process msiexec -ArgumentList "/i `"$msiPath`" /passive /norestart REINSTALLMODE=amus" -Verb RunAs -Wait -ErrorAction Stop',
    '    Log "MSI install completed"',
    '} catch {',
    '    Log "Install failed or UAC declined: $_"',
    '}',
    '',
    '# Always relaunch the app',
    'Log "Relaunching app: $appExe"',
    'Start-Process $appExe',
    '',
    '# Clean up installer (keep log for troubleshooting)',
    'Remove-Item $msiPath -Force -ErrorAction SilentlyContinue',
    'Remove-Item $MyInvocation.MyCommand.Path -Force -ErrorAction SilentlyContinue',
  ].join('\r\n');

  fs.writeFileSync(scriptPath, script, 'utf8');

  // Spawn detached PowerShell — survives after this process exits
  const child = spawn('powershell.exe', [
    '-ExecutionPolicy', 'Bypass',
    '-WindowStyle', 'Hidden',
    '-File', scriptPath,
  ], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();

  // Give the script a moment to start, then quit
  setTimeout(() => {
    app.quit();
  }, 500);
}

// ── Exports ───────────────────────────────────────────────────────────
module.exports = {
  CURRENT_VERSION,
  checkForUpdates,
  downloadAndVerifyUpdate,
  launchInstallerAndRestart,
  shouldCheckForUpdates,
  getAutoCheckEnabled,
  setAutoCheckEnabled,
  readUpdateState,
  writeUpdateState,
  compareVersions,
};
