/**
 * voiceSettings.js — Centralized voice/audio settings with localStorage persistence.
 *
 * Settings are stored under `drt_voiceSettings` so they persist across logouts,
 * app restarts, and server switches (they are **not** account-scoped — a user's
 * hardware preferences are personal to the machine).
 */

const STORAGE_KEY = 'drt_voiceSettings';

export const VOICE_DEFAULTS = {
  inputDeviceId: 'default',
  outputDeviceId: 'default',
  inputVolume: 1.0,          // 0.0 – 2.0  (pre-encode software gain)
  outputVolume: 1.0,         // 0.0 – 2.0  (playback gain)
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: false,
  inputGain: 1.5,            // final gain node multiplier (0.5 – 3.0)
  noiseGateThreshold: -40,   // dB  (–60 … –20)
};

/** Deep-clone defaults so callers never mutate the canonical copy. */
const cloneDefaults = () => JSON.parse(JSON.stringify(VOICE_DEFAULTS));

/* ── Event bus ─────────────────────────────────────────────────────── */
const listeners = new Set();

const notify = (settings) => {
  listeners.forEach((fn) => {
    try { fn(settings); } catch (e) { console.error('[VoiceSettings] listener error', e); }
  });
};

/* ── Public API ────────────────────────────────────────────────────── */

/** Load persisted settings (merged with defaults for forward-compat). */
export function loadVoiceSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...cloneDefaults(), ...parsed };
    }
  } catch (e) {
    console.warn('[VoiceSettings] Failed to parse stored settings — using defaults', e);
  }
  return cloneDefaults();
}

/** Persist the full settings object. */
export function saveVoiceSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error('[VoiceSettings] Failed to save', e);
  }
  notify(settings);
}

/** Update one or more keys, persist, and notify listeners. Returns the merged settings. */
export function updateVoiceSettings(partial) {
  const current = loadVoiceSettings();
  const merged = { ...current, ...partial };
  saveVoiceSettings(merged);
  return merged;
}

/** Reset everything back to defaults, persist, and notify. */
export function resetVoiceSettings() {
  const defaults = cloneDefaults();
  saveVoiceSettings(defaults);
  return defaults;
}

/** Subscribe to settings changes. Returns an unsubscribe function. */
export function onVoiceSettingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
