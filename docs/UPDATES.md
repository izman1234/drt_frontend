# DRT Desktop — Updates & Release Guide

## Overview

DRT Desktop supports **automatic update checks** and installs via **MSI installers** distributed through **GitHub Releases**.

---

## How Updates Work

### Automatic Checks
- On app startup, DRT checks GitHub for the latest release (at most once every 24 hours).
- If a newer version is found, a notification appears in the app.
- The check timestamp is persisted in `%APPDATA%\drt-frontend\update-state.json`.

### Manual Checks
- Open **Settings → Updates** and click **"Check for Updates"**.
- Or launch with `--check-updates` to force a check immediately.

### Update Flow
1. **Check** — app queries `GET https://api.github.com/repos/izman1234/drt_frontend/releases/latest`
2. **Compare** — installed version (from `package.json`) is compared against the latest tag (semver)
3. **Prompt** — if newer, the user sees release notes + download button
4. **Download** — the MSI installer is downloaded to a temp directory
5. **Verify** — SHA256 checksum is verified against the published `.sha256` file
6. **Install** — the app quits, a helper script runs `msiexec /i <path> /passive /norestart`, then re-launches the app

### Downgrade Protection
The updater **never** offers a version older than or equal to the currently installed version.

---

## GitHub Actions builds the release

When the `v*` tag is pushed, the CI workflow (`.github/workflows/release.yml`) will:

1. Verify the tag version matches `package.json` version
2. Install dependencies (`npm ci`)
3. Build the React app (`npm run build`)
4. Build the MSI installer via `electron-builder`
5. Compute SHA256 checksum
6. Create a GitHub Release with:
   - `DRT-Setup-1.2.3.msi` — the installer
   - `DRT-Setup-1.2.3.msi.sha256` — checksum file (format: `<hash>  <filename>`)
   - Auto-generated release notes from commits

---

## Release Artifacts

| File | Description |
|------|-------------|
| `DRT-Setup-X.Y.Z.msi` | Windows MSI installer |
| `DRT-Setup-X.Y.Z.msi.sha256` | SHA256 checksum for integrity verification |

---

## MSI Installer Features

- **Install location selection** — users choose where to install
- **Start Menu shortcut** — created automatically
- **Desktop shortcut** — created automatically
- **Clean upgrades** — MSI UpgradeCode ensures old versions are properly replaced
- **Uninstall** — available via Windows "Apps & Features" / "Add or Remove Programs"
- **Per-user install** — no administrator / UAC prompt required (default)

---

## Disabling Updates

### In the UI
Settings → Updates → uncheck **"Automatically check for updates"**

### Via CLI
```bash
DRT.exe --no-update
```
This skips all automatic update checks for that session.

### Force a Check
```bash
DRT.exe --check-updates
```
This forces an immediate check regardless of the 24-hour cooldown.

---

## Security Model

### Integrity Verification
- Every MSI has a corresponding `.sha256` checksum file published alongside it
- Before installing, the downloaded MSI's SHA256 hash is computed and compared
- If the hash doesn't match, the download is **rejected** and deleted

### Transport Security
- All GitHub API calls and downloads use **HTTPS only**
- The `User-Agent` header is set to `DRT-Desktop/<version>`

### Downgrade Prevention
- The updater compares versions using semver and **refuses** to install any version ≤ the current one
- Users cannot accidentally downgrade via the auto-updater

### Source Trust
- Updates are fetched exclusively from the configured GitHub repository
- The repository URL is read from `package.json` → `repository.url`

---

## Local Build

To build the MSI locally:

```bash
cd frontend
npm ci
npm run dist
```

The MSI will be output to `frontend/dist/`.

To build just the unpacked app (for testing):

```bash
npm run dist:dir
```

---

## Troubleshooting

### "Updater not available"
The updater module failed to load. This happens in development mode (normal) or if `updater.js` is missing from the packaged app.

### "No MSI installer found in the latest release"
The GitHub Release exists but doesn't contain a `.msi` file. Ensure the CI workflow completed successfully.

### SHA256 mismatch
The downloaded file's checksum doesn't match the published one. This could indicate:
- A corrupted download (retry)
- A tampered file (do not install — investigate)

### MSI requires elevation
If the MSI was built with `perMachine: true`, Windows will show a UAC prompt. The default configuration uses per-user install which does not require elevation.

### Update state file
Located at `%APPDATA%\drt-frontend\update-state.json`. Contains:
```json
{
  "lastCheckTimestamp": 1709740800000,
  "autoCheckEnabled": true
}
```
Delete this file to reset update state.
