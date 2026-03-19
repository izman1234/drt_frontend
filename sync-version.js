/**
 * sync-version.js — Reads the latest git tag and writes it into package.json.
 *
 * Run automatically before `npm run dist` so you never have to
 * remember to bump the version by hand.  Just tag and build:
 *
 *   git tag v1.2.3
 *   git push --tags
 *   npm run dist
 */

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PKG_PATH = path.join(__dirname, 'package.json');

// ── Get latest git tag ────────────────────────────────────────────────
let tag;
try {
  tag = execSync('git describe --tags --abbrev=0', { encoding: 'utf-8' }).trim();
} catch (err) {
  console.error('[sync-version] Could not read a git tag. Make sure you have at least one tag (e.g. git tag v1.0.0).');
  console.error('[sync-version]', err.message);
  process.exit(1);
}

const version = tag.replace(/^v/, '');

// Basic semver sanity check
if (!/^\d+\.\d+\.\d+/.test(version)) {
  console.error(`[sync-version] Tag "${tag}" does not look like a semver version (expected vX.Y.Z).`);
  process.exit(1);
}

// ── Update package.json ───────────────────────────────────────────────
const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf-8'));

if (pkg.version === version) {
  console.log(`[sync-version] package.json already at v${version} — nothing to do.`);
} else {
  const oldVersion = pkg.version;
  pkg.version = version;
  fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
  console.log(`[sync-version] Updated package.json version: ${oldVersion} → ${version}`);
}
