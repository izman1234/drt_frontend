/**
 * notifications.js — Desktop notification dispatch utility.
 *
 * Uses the Web Notification API (supported natively in Electron renderer).
 * Handles permission requests, rate-limiting, and click-to-focus.
 */

/* ── Rate-limiting state ───────────────────────────────────────────── */
const lastNotifByChannel = new Map(); // channelId → timestamp
const RATE_LIMIT_MS = 2000; // max 1 notification per channel per 2 seconds

/**
 * Request notification permission if not already granted.
 * Should be called once on app mount.
 */
export function requestNotificationPermission() {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
}

/**
 * Send a desktop notification.
 * @param {Object} opts
 * @param {string} opts.title   - Notification title
 * @param {string} opts.body    - Notification body text
 * @param {string} [opts.icon]  - Optional icon URL
 * @param {string} [opts.channelId] - Optional channel ID for rate-limiting
 * @param {Function} [opts.onClick] - Optional callback when notification is clicked
 */
export function sendNotification({ title, body, icon, channelId, onClick }) {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;

  // Rate-limit per channel
  if (channelId) {
    const last = lastNotifByChannel.get(channelId) || 0;
    if (Date.now() - last < RATE_LIMIT_MS) return;
    lastNotifByChannel.set(channelId, Date.now());
  }

  try {
    const notif = new Notification(title, {
      body: body ? body.substring(0, 200) : '', // truncate long messages
      icon,
      silent: false,
    });

    notif.onclick = () => {
      window.focus();
      if (onClick) onClick();
      notif.close();
    };

    // Auto-close after 5 seconds
    setTimeout(() => notif.close(), 5000);
  } catch (e) {
    console.warn('[Notifications] Failed to send notification:', e);
  }
}

/**
 * Determine whether a message notification should fire.
 * @param {Object} params
 * @param {Object} params.settings       - Notification settings from notificationSettings.js
 * @param {boolean} params.isWindowFocused - Whether the app window is currently focused
 * @param {string} params.messageChannelId - Channel the message was received in
 * @param {string|null} params.selectedChannelId - Currently viewed channel ID
 * @param {string} params.messageUserId   - Who sent the message
 * @param {string} params.currentUserId   - The local user's ID
 * @param {boolean} params.isMention      - Whether the message contains an @mention of current user
 * @param {boolean} params.isReply        - Whether the message replies to current user's message
 * @returns {boolean}
 */
export function shouldNotifyForMessage({ settings, isWindowFocused, messageChannelId, selectedChannelId, messageUserId, currentUserId, isMention, isReply }) {
  if (!settings.enabled) return false;
  if (messageUserId === currentUserId) return false;

  // @ mentions always notify (if mention toggle is on), regardless of level
  if (isMention && settings.mentions) return true;

  // Replies to my messages always notify (if reply toggle is on), regardless of level
  if (isReply && settings.replies) return true;

  const level = settings.level;

  // Level 1: no message notifications
  if (level === 1) return false;

  // Level 2: only current channel, only when unfocused
  if (level === 2) {
    if (messageChannelId !== selectedChannelId) return false;
    if (isWindowFocused) return false;
    return true;
  }

  // Level 3: other channels only — notify for messages NOT in the current channel
  if (level === 3) {
    if (messageChannelId === selectedChannelId) return false;
    return true;
  }

  // Level 4: all channels — notify when unfocused OR on a different channel
  if (level === 4) {
    if (isWindowFocused && messageChannelId === selectedChannelId) return false;
    return true;
  }

  return false;
}
