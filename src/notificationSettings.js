/**
 * notificationSettings.js — Notification preferences with localStorage persistence.
 *
 * Settings are account-scoped (keyed by identityPublicKey base64) so each
 * identity on the same machine can have independent notification preferences.
 */

const STORAGE_PREFIX = 'drt_notif_';

export const NOTIF_DEFAULTS = {
  enabled: true,           // Master toggle for desktop notifications
  reactions: true,         // Notify when someone reacts to my messages
  mentions: true,          // Notify when someone @mentions me
  replies: true,           // Notify when someone replies to my messages
  level: 2,               // 1 = none, 2 = current channel, 3 = all channels
  voice: true,             // Notify when someone joins/leaves my voice channel
  displayMode: 'inapp',   // 'inapp' = in-app only, 'desktop' = native only, 'both' = smart mix
};

/** Build the localStorage key for a given setting + account. */
const storageKey = (key, accountKey) => `${STORAGE_PREFIX}${key}_${accountKey}`;

/** Deep-clone defaults so callers never mutate the canonical copy. */
const cloneDefaults = () => JSON.parse(JSON.stringify(NOTIF_DEFAULTS));

/* ── Event bus ─────────────────────────────────────────────────────── */
const listeners = new Set();

const notify = (settings) => {
  listeners.forEach((fn) => {
    try { fn(settings); } catch (e) { console.error('[NotifSettings] listener error', e); }
  });
};

/* ── Public API ────────────────────────────────────────────────────── */

/** Load persisted notification settings for the given account. */
export function loadNotificationSettings(accountKey) {
  const settings = cloneDefaults();
  if (!accountKey) return settings;

  try {
    for (const key of Object.keys(NOTIF_DEFAULTS)) {
      const raw = localStorage.getItem(storageKey(key, accountKey));
      if (raw !== null) {
        // Parse booleans and numbers correctly
        if (raw === 'true') settings[key] = true;
        else if (raw === 'false') settings[key] = false;
        else if (!isNaN(Number(raw))) settings[key] = Number(raw);
        else settings[key] = raw;
      }
    }
  } catch (e) {
    console.warn('[NotifSettings] Failed to load — using defaults', e);
  }
  return settings;
}

/** Persist the full settings object for the given account. */
export function saveNotificationSettings(settings, accountKey) {
  if (!accountKey) return;
  try {
    for (const [key, value] of Object.entries(settings)) {
      localStorage.setItem(storageKey(key, accountKey), String(value));
    }
  } catch (e) {
    console.error('[NotifSettings] Failed to save', e);
  }
  notify(settings);
}

/** Update one or more keys, persist, and notify listeners. Returns the merged settings. */
export function updateNotificationSettings(partial, accountKey) {
  const current = loadNotificationSettings(accountKey);
  const merged = { ...current, ...partial };
  saveNotificationSettings(merged, accountKey);
  return merged;
}

/** Reset everything back to defaults, persist, and notify. */
export function resetNotificationSettings(accountKey) {
  const defaults = cloneDefaults();
  saveNotificationSettings(defaults, accountKey);
  return defaults;
}

/** Subscribe to settings changes. Returns an unsubscribe function. */
export function onNotificationSettingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
