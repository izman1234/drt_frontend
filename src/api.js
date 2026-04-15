import axios from 'axios';

// ── Dynamic server URL ────────────────────────────────────────────────
let serverUrl = localStorage.getItem('serverUrl') || 'http://localhost:5000';

const api = axios.create();

// Interceptor: set baseURL and auth token on every request
api.interceptors.request.use((config) => {
  config.baseURL = `${serverUrl}/api`;
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export function setServerUrl(url) {
  serverUrl = url.replace(/\/+$/, ''); // strip trailing slashes
  localStorage.setItem('serverUrl', serverUrl);
}

export function getServerUrl() {
  return serverUrl;
}

// ── Identity auth API ─────────────────────────────────────────────────
export const identityAPI = {
  /** Check if a public key exists on the server and its auth version */
  checkUser: (publicKey) =>
    api.get(`/auth/identity/check/${encodeURIComponent(publicKey)}`),
  /** Register a new identity on the server */
  register: (username, displayName, identityPublicKey, recoveryPublicKey) =>
    api.post('/auth/identity/register', { username, displayName, identityPublicKey, recoveryPublicKey }),
  /** Request a challenge nonce for auth. type = 'identity' | 'recovery' */
  challenge: ({ identityPublicKey, username, type = 'identity' } = {}) =>
    api.post('/auth/identity/challenge', { identityPublicKey, username, type }),
  /** Submit a signed challenge to verify identity and get JWT */
  verify: (challengeId, signature) =>
    api.post('/auth/identity/verify', { challengeId, signature }),
  /** Upload encrypted backup blob (requires JWT) */
  uploadBackupBlob: (blob) =>
    api.put('/auth/identity/backup-blob', { blob }),
  /** Download backup blob using recovery-key auth */
  downloadBackupBlob: ({ identityPublicKey, username, challengeId, signature }) =>
    api.post('/auth/identity/backup-blob/download', { identityPublicKey, username, challengeId, signature }),
  /** Rotate identity key using recovery-key auth */
  rotateKey: ({ identityPublicKey, username, newIdentityPublicKey, challengeId, signature }) =>
    api.post('/auth/identity/rotate-key', { identityPublicKey, username, newIdentityPublicKey, challengeId, signature }),
};

export const userAPI = {
  getProfile: () => api.get('/users/profile'),
  updateDisplayName: (displayName) =>
    api.put('/users/displayName', { displayName }),
  updateProfilePicture: (profilePicture) =>
    api.put('/users/profilePicture', { profilePicture }),
  updateNameColor: (nameColor) =>
    api.put('/users/nameColor', { nameColor }),
  updateBio: (bio) =>
    api.put('/users/bio', { bio }),
  updateCustomStatus: (customStatus) =>
    api.put('/users/customStatus', { customStatus }),
  getAllUsers: () => api.get('/users/all'),
  leaveServer: () => api.delete('/users/leave')
};

export const channelAPI = {
  createChannel: (name, description, type) =>
    api.post('/channels', { name, description, type }),
  getAllChannels: () => api.get('/channels'),
  getChannel: (channelId) => api.get(`/channels/${channelId}`),
  joinChannel: (channelId) => api.post(`/channels/${channelId}/join`),
  leaveChannel: (channelId) => api.post(`/channels/${channelId}/leave`),
  getMembers: (channelId) => api.get(`/channels/${channelId}/members`),
  updateChannel: (channelId, name, description) =>
    api.put(`/channels/${channelId}`, { name, description }),
  deleteChannel: (channelId) =>
    api.delete(`/channels/${channelId}`),
  reorderChannel: (channelId, newIndex, type) =>
    api.put(`/channels/${channelId}/reorder`, { newIndex, type }),
  markChannelRead: (channelId) =>
    api.put(`/channels/${channelId}/read`),
  getUnreadChannels: () =>
    api.get('/channels/unread/list')
};

export const messageAPI = {
  sendMessage: (channelId, content, images = null, replyTo = null, signature = null, signingPayload = null) =>
    api.post('/messages', { channelId, content, images, replyTo, signature, signingPayload }),
  getMessages: (channelId, limit = 50, { beforeRowId = null, aroundMessageId = null, afterRowId = null } = {}) => 
    api.get(`/messages/channel/${channelId}`, { params: { limit, beforeRowId, aroundMessageId, afterRowId } }),
  editMessage: (messageId, content, removeImage = false) =>
    api.put(`/messages/${messageId}`, { content, removeImage }),
  deleteMessage: (messageId) => api.delete(`/messages/${messageId}`)
};

export const reactionAPI = {
  addReaction: (messageId, emoji) =>
    api.post(`/reactions/${messageId}`, { emoji }),
  removeReaction: (messageId, emoji) =>
    api.delete(`/reactions/${messageId}/${emoji}`)
};

export const gifAPI = {
  searchGifs: (query, per_page = 24, page = 1) =>
    api.get('/gifs/search', { params: { q: query, per_page, page } }),
  getTrendingGifs: (per_page = 24, page = 1) =>
    api.get('/gifs/trending', { params: { per_page, page } }),
  getCategories: () =>
    api.get('/gifs/categories'),
  getCategoryGifs: (categoryName, per_page = 24, page = 1) =>
    api.get(`/gifs/category/${categoryName}`, { params: { per_page, page } })
};

// ── Server info (public, no auth required) ────────────────────────────
export async function fetchServerInfo(url) {
  const cleanUrl = url.replace(/\/+$/, '');
  const response = await axios.get(`${cleanUrl}/api/server/info`, {
    timeout: 5000,
  });
  return response.data;
}

/**
 * Given a bare address (ip:port) or a full URL, resolve to the best
 * reachable URL for this client.
 *
 * Probing order:
 *   1. Explicit URL as-is (if protocol was given)
 *   2. HTTPS on port+1  (dual-protocol / dev mode)
 *   3. HTTPS on port    (production / single-port HTTPS)
 *   4. HTTP  on port    (fallback for browsers)
 *
 * Returns { url, serverInfo } on success, or throws.
 */
export async function resolveServerUrl(input) {
  const raw = input.trim().replace(/\/+$/, '');
  const hasProtocol = raw.startsWith('http://') || raw.startsWith('https://');

  // Parse host and port from the input
  const bare = raw.replace(/^https?:\/\//, '');
  const colonIdx = bare.lastIndexOf(':');
  const host = colonIdx > 0 ? bare.substring(0, colonIdx) : bare;
  const port = colonIdx > 0 ? parseInt(bare.substring(colonIdx + 1), 10) : 5000;

  // Helper: probe a URL
  const probe = async (url) => {
    const info = await fetchServerInfo(url);
    if (!info || !info.name) throw new Error('Invalid');
    return { url, serverInfo: info };
  };

  // If an explicit protocol+URL was given, try it first and as-is
  if (hasProtocol) {
    try { return await probe(raw); } catch { /* fall through */ }
  }

  // 1. HTTPS on port+1 (dual-protocol / dev mode)
  try { return await probe(`https://${host}:${port + 1}`); } catch {}

  // 2. HTTPS on same port (production single-port HTTPS)
  try { return await probe(`https://${host}:${port}`); } catch {}

  // 3. HTTP on base port (browser fallback / TLS unavailable)
  try { return await probe(`http://${host}:${port}`); } catch {}

  throw new Error(
    `Cannot reach server at ${raw}. ` +
    'Make sure the server is running and the address is correct.'
  );
}

export default api;
