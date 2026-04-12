import React, { useState, useEffect, useRef } from 'react';
import { channelAPI, messageAPI, userAPI, reactionAPI, identityAPI, setServerUrl, fetchServerInfo, resolveServerUrl } from '../api';
import { signData, createMessageSigningPayload, createBackupBlob, signChallenge, toBase64 } from '../crypto';
import io from 'socket.io-client';
import ChannelList from './ChannelList';
import MessageArea from './MessageArea';
import UserList from './UserList';
import VoiceArea from './VoiceArea';
import ImageCropper from './ImageCropper';
import ColorPicker from './ColorPicker';
import ServerList from './ServerList';
import CustomModal from './CustomModal';
import VoiceSettings from './VoiceSettings';
import ProfileModal from './ProfileModal';
import Twemoji from './Twemoji';
import './Main.css';

function Main({ onLogout, identityKeys }) {
  // ── Per-account key for scoping localStorage ───────────────────────
  const accountKey = toBase64(identityKeys.publicKey);
  
  const normalizeNameColor = (color) => {
    // Convert old grey defaults to new purple
    if (color === '#b9bbbe' || color === '#b5bac1') {
      return '#a78bba';
    }
    return color || '#a78bba';
  };
  
  const [channels, setChannels] = useState([]);
  const [selectedChannel, setSelectedChannel] = useState(null);
  const [messages, setMessages] = useState([]);
  const [, setOldestMessageRowId] = useState(null);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [newChannelData, setNewChannelData] = useState({ name: '', description: '', type: 'text' });
  const [users, setUsers] = useState([]);
  const [voiceMembersByChannel, setVoiceMembersByChannel] = useState({});
  const [socket, setSocket] = useState(null);
  const [activeVoiceChannel, setActiveVoiceChannel] = useState(null);
  const [userDisplayName, setUserDisplayName] = useState(localStorage.getItem(`drt_displayName_${accountKey}`) || localStorage.getItem('drt_displayName') || 'User');
  const [username, setUsername] = useState(localStorage.getItem('drt_username') || localStorage.getItem('username') || '');
  const [userNameColor, setUserNameColor] = useState(localStorage.getItem(`drt_nameColor_${accountKey}`) || '#a78bba');
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState('user');
  const [copiedPubKey, setCopiedPubKey] = useState(false);
  const [settingsForm, setSettingsForm] = useState({ displayName: localStorage.getItem(`drt_displayName_${accountKey}`) || localStorage.getItem('drt_displayName') || 'User', nameColor: localStorage.getItem(`drt_nameColor_${accountKey}`) || '#a78bba', bio: localStorage.getItem(`drt_bio_${accountKey}`) || '' });
  const [profilePicture, setProfilePicture] = useState(localStorage.getItem(`drt_profilePicture_${accountKey}`) || null);
  const [showImageCropper, setShowImageCropper] = useState(false);
  const [imageDataToEdit, setImageDataToEdit] = useState(null);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [speakingUsers, setSpeakingUsers] = useState({});
  const [selectedUserForControl, setSelectedUserForControl] = useState(null);
  const [userVolumes, setUserVolumes] = useState({}); // { userId: 0-2 } (slider value, squared for gain)
  const [userMutes, setUserMutes] = useState({}); // { userId: boolean }
  const [unreadChannels, setUnreadChannels] = useState(new Set()); // Set of channel IDs with unread messages
  const [mentionCounts, setMentionCounts] = useState({}); // { channelId: number }
  const [typingUsers, setTypingUsers] = useState({}); // { "channelId:userId": { channelId, userId, displayName } }
  const [profileModalUser, setProfileModalUser] = useState(null);
  const [profileModalPosition, setProfileModalPosition] = useState(null);
  const [showProfilePreview, setShowProfilePreview] = useState(false);
  const typingTimersRef = useRef({});
  const [serverBackupEnabled, setServerBackupEnabled] = useState(
    localStorage.getItem('drt_serverBackup') !== 'false'
  );

  // ── Updater state ───────────────────────────────────────────────────
  const [appVersion, setAppVersion] = useState('');
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(true);
  const [updateInfo, setUpdateInfo] = useState(null); // null = not checked, object = update available
  const [updateStatus, setUpdateStatus] = useState('idle'); // idle | checking | downloading | ready | installing | error | up-to-date
  const [updateError, setUpdateError] = useState('');
  const [updateProgress, setUpdateProgress] = useState(0);
  const [downloadedMsiPath, setDownloadedMsiPath] = useState(null);

  // ── Multi-server state ──────────────────────────────────────────────
  const [servers, setServers] = useState([]);
  const [connectedServer, setConnectedServer] = useState(null);
  const [serverListOpen, setServerListOpen] = useState(true);
  const [connectingServer, setConnectingServer] = useState(false);
  const [serverError, setServerError] = useState('');
  const [lastAttemptedServer, setLastAttemptedServer] = useState(null);
  const [modalInfo, setModalInfo] = useState({ open: false, title: '', message: '', type: 'alert', onConfirm: null });

  const showModal = (message, { title = '', type = 'alert', onConfirm } = {}) => {
    setModalInfo({ open: true, title, message, type, onConfirm: onConfirm || null });
  };
  const closeModal = (confirmed = false) => {
    const info = modalInfo;
    setModalInfo(prev => ({ ...prev, open: false }));
    if (confirmed && info.onConfirm) info.onConfirm();
  };

  // Idle detection constant (30 seconds of inactivity = away)
  const IDLE_TIMEOUT = 30000;

  // ── Updater initialization ──────────────────────────────────────────
  useEffect(() => {
    if (!window.electron) return;
    // Load app version
    window.electron.getAppVersion().then(v => setAppVersion(v)).catch(() => {});
    // Load auto-update preference
    window.electron.getAutoUpdateEnabled().then(v => setAutoUpdateEnabled(v)).catch(() => {});
    // Listen for auto-check update notifications from main process
    window.electron.onUpdateAvailable((info) => {
      setUpdateInfo(info);
      setUpdateStatus('idle');
    });
    // Listen for download progress
    window.electron.onUpdateDownloadProgress((progress) => {
      setUpdateProgress(progress.percent);
    });
  }, []);

  // Handlers to toggle mute/deafen and inform server
  const handleToggleMute = () => {
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    const userId = localStorage.getItem('userId');
    if (socket && userId) {
      socket.emit('voice:set-muted', { userId, isMuted: newMuted });
      // If the user was deafened and is now unmuting, also undeafen them
      if (!newMuted && isDeafened) {
        setIsDeafened(false);
        socket.emit('voice:set-deafened', { userId, isDeafened: false });
      }
    }
  };

  const handleToggleDeafen = () => {
    const newDeaf = !isDeafened;
    // When deafening, also ensure muted state matches requirement
    setIsDeafened(newDeaf);
    // If deafening, force mute; if undeafening, also unmute
    setIsMuted(newDeaf ? true : false);
    const userId = localStorage.getItem('userId');
    if (socket && userId) {
      socket.emit('voice:set-deafened', { userId, isDeafened: newDeaf });
      // Also emit mute state for consistency
      socket.emit('voice:set-muted', { userId, isMuted: newDeaf ? true : false });
    }
  };

  const handleVolumeChange = (userId, volume) => {
    const currentUserId = localStorage.getItem('userId');
    setUserVolumes(prev => ({ ...prev, [userId]: volume }));
    localStorage.setItem(`voiceVolume_${currentUserId}_${userId}`, volume);
  };

  const handleToggleMuteUser = (userId) => {
    const currentUserId = localStorage.getItem('userId');
    const newMuteState = !userMutes[userId];
    setUserMutes(prev => ({ ...prev, [userId]: newMuteState }));
    localStorage.setItem(`voiceMute_${currentUserId}_${userId}`, newMuteState);
  };

  // Initialize volume and mute settings from localStorage when voice members change
  useEffect(() => {
    const currentUserId = localStorage.getItem('userId');
    if (voiceMembersByChannel && activeVoiceChannel) {
      const membersInChannel = voiceMembersByChannel[activeVoiceChannel.id] || [];
      membersInChannel.forEach(member => {
        // Load volume setting
        if (member.id !== currentUserId && !(member.id in userVolumes)) {
          const volumeKey = `voiceVolume_${currentUserId}_${member.id}`;
          const savedVolume = localStorage.getItem(volumeKey);
          if (savedVolume !== null) {
            handleVolumeChange(member.id, parseFloat(savedVolume));
          }
        }
        
        // Load mute setting
        if (member.id !== currentUserId && !(member.id in userMutes)) {
          const muteKey = `voiceMute_${currentUserId}_${member.id}`;
          const savedMute = localStorage.getItem(muteKey);
          if (savedMute !== null) {
            const shouldBeMuted = savedMute === 'true';
            setUserMutes(prev => ({ ...prev, [member.id]: shouldBeMuted }));
            localStorage.setItem(muteKey, shouldBeMuted);
          }
        }
      });
    }
  }, [voiceMembersByChannel, activeVoiceChannel, userVolumes, userMutes]);

  // ── Server list helpers ─────────────────────────────────────────────
  function getSavedServers() {
    try {
      return JSON.parse(localStorage.getItem(`drt_servers_${accountKey}`)) || [];
    } catch { return []; }
  }

  function saveServerList(list) {
    localStorage.setItem(`drt_servers_${accountKey}`, JSON.stringify(list));
  }

  function generateServerId() {
    return 'srv_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
  }

  // ── Toggle server list visibility ───────────────────────────────
  const handleLogoClick = () => setServerListOpen(open => !open);

  // ── Connect to a server (authenticate + initialize) ─────────────────
  const handleConnectToServer = async (server) => {
    // Track the server being attempted so we can retry on failure
    setLastAttemptedServer(server);

    // Disconnect existing socket if any
    if (socket) {
      socket.disconnect();
      setSocket(null);
    }

    // Reset state for new server
    setChannels([]);
    setMessages([]);
    setSelectedChannel(null);
    setUsers([]);
    setVoiceMembersByChannel({});
    setActiveVoiceChannel(null);
    setUnreadChannels(new Set());
    setTypingUsers({});
    setServerError('');

    try {
      // 1. In Electron, upgrade to HTTPS (TOFU trusts self-signed certs).
      //    Check server info to determine the right HTTPS URL:
      //    - If server returns httpsPort → dual-protocol (dev), use that port
      //    - If server URL is already https:// → production, already good
      //    - Otherwise → try HTTPS on same host:port (production default)
      if (window.electron && server.url.startsWith('http://')) {
        try {
          // First get server info via HTTP to check for httpsPort hint
          const info = await fetchServerInfo(server.url);
          let httpsUrl;
          if (info.httpsPort) {
            // Dual-protocol mode: HTTPS is on a different port
            const parsed = new URL(server.url);
            httpsUrl = `https://${parsed.hostname}:${info.httpsPort}`;
          } else if (info.tls) {
            // Production mode: HTTPS on same host:port
            httpsUrl = server.url.replace(/^http:\/\//, 'https://');
          }
          if (httpsUrl) {
            await fetchServerInfo(httpsUrl);
            // HTTPS works — upgrade the saved URL
            server = { ...server, url: httpsUrl };
            const updatedServers = getSavedServers().map(s =>
              s.id === server.id ? { ...s, url: httpsUrl } : s
            );
            saveServerList(updatedServers);
            setServers(updatedServers);
          }
        } catch { /* HTTPS not available — keep HTTP */ }
      }

      // 2. Set API base URL to this server
      setServerUrl(server.url);

      // 3. Get identity info
      const username = localStorage.getItem('drt_username');
      const displayName = localStorage.getItem('drt_displayName') || username;
      const publicKeyBase64 = toBase64(identityKeys.publicKey);
      const storedIdentity = JSON.parse(localStorage.getItem('drt_identity'));

      // 3. Check if our public key exists on this server
      let checkResult;
      try {
        checkResult = (await identityAPI.checkUser(publicKeyBase64)).data;
      } catch (netErr) {
        // The saved URL didn't work — try auto-resolving.
        // If the saved URL was a dual-protocol HTTPS port (e.g. :5001) and the
        // server switched to single-port mode (:5000), we also need to try the
        // base port (port - 1).
        try {
          const bare = server.url.replace(/^https?:\/\//, '');
          let resolved;
          try {
            resolved = await resolveServerUrl(bare);
          } catch {
            // Try base port (port - 1) in case server switched from dual to single
            const parsed = new URL(server.url);
            const port = parseInt(parsed.port);
            if (port > 1) {
              const baseBare = `${parsed.hostname}:${port - 1}`;
              resolved = await resolveServerUrl(baseBare);
            } else {
              throw netErr;
            }
          }
          if (resolved.url !== server.url) {
            // Update saved server entry with the working URL
            server = { ...server, url: resolved.url };
            setServerUrl(resolved.url);
            const updatedServers = getSavedServers().map(s =>
              s.id === server.id ? { ...s, url: resolved.url } : s
            );
            saveServerList(updatedServers);
            setServers(updatedServers);
            checkResult = (await identityAPI.checkUser(publicKeyBase64)).data;
          } else {
            throw netErr; // same URL, still failing
          }
        } catch {
          throw new Error(`Cannot reach server at ${server.url}. Check the address and try again.`);
        }
      }

      if (!checkResult.exists) {
        // Register new identity on server
        const recoveryPubKey = storedIdentity?.recoveryPublicKey || null;
        try {
          await identityAPI.register(username, displayName, publicKeyBase64, recoveryPubKey);
        } catch (regErr) {
          // 409 = identity already registered (stale check or race).
          // Fall through to challenge/verify which will succeed if our key matches.
          if (!regErr.response || regErr.response.status !== 409) throw regErr;
        }
      }

      // 4. Challenge/response authentication
      const challengeRes = (await identityAPI.challenge({ identityPublicKey: publicKeyBase64 })).data;
      const signature = await signChallenge(challengeRes.challenge, identityKeys.privateKey);
      const verifyRes = (await identityAPI.verify(challengeRes.challengeId, signature)).data;

      if (!verifyRes.success) {
        throw new Error('Server rejected identity signature');
      }

      // 5. Store session data
      localStorage.setItem('token', verifyRes.token);
      localStorage.setItem('userId', verifyRes.userId);
      localStorage.setItem('username', verifyRes.username);

      // 5a. Push any locally-changed display name, name color, or avatar to this server
      const localDisplayName = localStorage.getItem(`drt_displayName_${accountKey}`) || localStorage.getItem('drt_displayName');
      if (localDisplayName && localDisplayName !== verifyRes.displayName) {
        try { await userAPI.updateDisplayName(localDisplayName); } catch {}
      }
      // Persist resolved display name locally
      localStorage.setItem(`drt_displayName_${accountKey}`, localDisplayName || verifyRes.displayName);
      localStorage.setItem('drt_displayName', localDisplayName || verifyRes.displayName);

      const localNameColor = localStorage.getItem(`drt_nameColor_${accountKey}`);
      if (localNameColor) {
        try { await userAPI.updateNameColor(localNameColor); } catch {}
      }

      const localAvatar = localStorage.getItem(`drt_profilePicture_${accountKey}`);
      if (localAvatar) {
        try { await userAPI.updateProfilePicture(localAvatar); } catch {}
      }

      // 6. Optionally upload backup blob
      try {
        if (storedIdentity && localStorage.getItem('drt_serverBackup') !== 'false') {
          const blob = createBackupBlob(storedIdentity);
          await identityAPI.uploadBackupBlob(blob);
        }
      } catch (blobErr) {
        console.warn('Failed to upload backup blob (non-critical):', blobErr.message);
      }

      // 7. Update server info (name/icon) from the server
      try {
        const info = await fetchServerInfo(server.url);
        if (info.name !== undefined || info.icon !== undefined) {
          const updatedServers = getSavedServers().map(s =>
            s.id === server.id
              ? { ...s, name: info.name || s.name, icon: 'icon' in info ? info.icon : s.icon }
              : s
          );
          saveServerList(updatedServers);
          setServers(updatedServers);
          server = { ...server, name: info.name || server.name, icon: 'icon' in info ? info.icon : server.icon };
        }
      } catch {}

      // 8. Initialize Socket.io connection
      const token = localStorage.getItem('token');
      const socketInstance = io(server.url, {
        auth: { token },
        rejectUnauthorized: false,
      });

      // Register critical listeners immediately on the socket instance
      // BEFORE setSocket() triggers a React re-render. This prevents
      // the race where the backend broadcasts user_list_update (after
      // setting our status to 'online') but the React useEffect hasn't
      // registered its listener yet, causing the broadcast to be lost.
      socketInstance.on('user_list_update', (updatedUsers) => {
        setUsers(updatedUsers);
      });
      socketInstance.on('voice:room-members-update', ({ channelId, members }) => {
        setVoiceMembersByChannel(prev => ({ ...prev, [channelId]: members }));
      });

      // Wait for the socket to actually connect before loading data.
      // The backend updates our status to 'online' asynchronously (DB write)
      // when it processes the connection, so we wait for the socket 'connect'
      // event plus a brief delay for the DB write to complete.
      await new Promise((resolve) => {
        if (socketInstance.connected) {
          resolve();
        } else {
          socketInstance.once('connect', resolve);
          // Safety timeout — don't block forever if connection is slow;
          // data will self-correct via the user_list_update listener.
          setTimeout(resolve, 5000);
        }
      });

      // Reset mute/deafen state on every fresh connection so the UI always
      // starts unmuted and in sync with the backend (which also resets on
      // connection). This runs HERE instead of in a useEffect socket.on('connect')
      // handler because by the time setSocket triggers the effect, the socket
      // is already connected and the 'connect' event has already fired.
      setIsMuted(false);
      setIsDeafened(false);
      const storedUserId = localStorage.getItem('userId');
      if (storedUserId) {
        socketInstance.emit('voice:set-muted', { userId: storedUserId, isMuted: false });
        socketInstance.emit('voice:set-deafened', { userId: storedUserId, isDeafened: false });
      }

      // Small delay after socket connect to let the backend's async DB write
      // (UPDATE status='online') and broadcastUserList() complete before we
      // make REST calls that read from the same DB.
      await new Promise(resolve => setTimeout(resolve, 300));

      setSocket(socketInstance);

      // 9. Set connected server and persist last selection
      setConnectedServer(server);
      localStorage.setItem(`drt_lastServer_${accountKey}`, server.id);

      // 10. Update local user state — prefer locally-stored name (already synced to server)
      const resolvedDisplayName = localStorage.getItem(`drt_displayName_${accountKey}`) || localStorage.getItem('drt_displayName') || verifyRes.displayName || 'User';
      setUserDisplayName(resolvedDisplayName);
      setUsername(verifyRes.username || '');

      // 11. Load data from this server (socket is connected, status updated)
      loadChannels();
      loadUsers();
      loadProfile();
      loadUnreadChannels();
    } catch (err) {
      console.error('Server connection error:', err);
      setServerError(err.message || 'Failed to connect to server');
      setConnectedServer(null);
    } finally {
      setConnectingServer(false);
    }
  };

  // ── Add a new server to the list ────────────────────────────────────
  const handleAddServer = async (url) => {
    const raw = url.replace(/\/+$/, '');

    // Check if already in list (quick check on raw input)
    const existing = getSavedServers();
    if (existing.some(s => s.url === raw)) {
      throw new Error('This server is already in your list');
    }

    // Resolve to HTTPS URL (DRT servers always use HTTPS)
    let cleanUrl, serverInfo;
    try {
      const resolved = await resolveServerUrl(raw);
      cleanUrl = resolved.url;
      serverInfo = resolved.serverInfo;
    } catch {
      throw new Error(`Cannot reach server at ${raw}`);
    }

    // Re-check deduplication after URL resolution
    if (existing.some(s => s.url === cleanUrl)) {
      throw new Error('This server is already in your list');
    }

    const newServer = {
      id: generateServerId(),
      url: cleanUrl,
      name: serverInfo.name || cleanUrl,
      icon: serverInfo.icon || null,
    };

    const updatedList = [...existing, newServer];
    saveServerList(updatedList);
    setServers(updatedList);

    // Auto-connect to the newly added server
    await handleConnectToServer(newServer);
  };

  // ── Remove a server from the list ───────────────────────────────────
  const handleRemoveServer = async (server) => {
    // If we have a token for this server, tell it we're leaving
    try {
      setServerUrl(server.url);
      // Authenticate first if not already connected to this server
      const publicKeyBase64 = toBase64(identityKeys.publicKey);
      const challengeRes = (await identityAPI.challenge({ identityPublicKey: publicKeyBase64 })).data;
      const signature = await signChallenge(challengeRes.challenge, identityKeys.privateKey);
      const verifyRes = (await identityAPI.verify(challengeRes.challengeId, signature)).data;
      if (verifyRes.success) {
        localStorage.setItem('token', verifyRes.token);
        await userAPI.leaveServer();
      }
    } catch (err) {
      console.warn('Could not notify server of leave (may be offline):', err.message);
    }

    // Remove from local list
    const updated = getSavedServers().filter(s => s.id !== server.id);
    saveServerList(updated);
    setServers(updated);

    // If we're connected to this server, disconnect
    if (connectedServer && connectedServer.id === server.id) {
      if (socket) {
        socket.disconnect();
        setSocket(null);
      }
      setConnectedServer(null);
      setChannels([]);
      setMessages([]);
      setSelectedChannel(null);
      setUsers([]);
      setVoiceMembersByChannel({});
      setActiveVoiceChannel(null);
      setUnreadChannels(new Set());
      localStorage.removeItem(`drt_lastServer_${accountKey}`);
    }
  };

  // ── Change a server's IP/port ───────────────────────────────────────
  const handleChangeServerUrl = async (server, newUrl) => {
    const updatedServer = { ...server, url: newUrl };
    const updated = getSavedServers().map(s =>
      s.id === server.id ? { ...s, url: newUrl } : s
    );
    saveServerList(updated);
    setServers(updated);

    // Auto-connect to the server at its new address
    await handleConnectToServer(updatedServer);
  };

  // ── On mount: load saved servers, migrate old global data, and auto-connect ──
  useEffect(() => {
    // Migrate old global drt_servers / drt_lastServer to per-account keys (one-time)
    const accountServersKey = `drt_servers_${accountKey}`;
    const accountLastKey = `drt_lastServer_${accountKey}`;
    if (!localStorage.getItem(accountServersKey) && localStorage.getItem('drt_servers')) {
      localStorage.setItem(accountServersKey, localStorage.getItem('drt_servers'));
      localStorage.removeItem('drt_servers');
    }
    if (!localStorage.getItem(accountLastKey) && localStorage.getItem('drt_lastServer')) {
      localStorage.setItem(accountLastKey, localStorage.getItem('drt_lastServer'));
      localStorage.removeItem('drt_lastServer');
    }

    const savedServers = getSavedServers();
    setServers(savedServers);

    const lastServerId = localStorage.getItem(`drt_lastServer_${accountKey}`);
    if (lastServerId && savedServers.length > 0) {
      const lastServer = savedServers.find(s => s.id === lastServerId);
      if (lastServer) {
        handleConnectToServer(lastServer);
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── TOFU certificate event listeners (Electron only) ────────────────
  useEffect(() => {
    if (!window.electron) return;

    // Informational: a new server cert was trusted on first contact
    window.electron.onTofuNewCert?.((data) => {
      console.log(`[TOFU] Trusted new certificate for ${data.hostname} (${data.fingerprint})`);
    });

    // Warning: a server's cert fingerprint changed since first contact.
    // This is informational — the new cert is auto-accepted, but the
    // user should be aware (could indicate server update or MITM).
    window.electron.onTofuMismatch?.((data) => {
      console.warn(`[TOFU] Certificate changed for ${data.hostname}:`, data.expected, '→', data.got);
    });
  }, []);

  // ── Socket event listeners (re-attach when socket changes) ──────────
  useEffect(() => {
    if (!socket) return;

    const currentUserId = localStorage.getItem('userId');

    socket.on('connect', () => {
      // This fires ONLY on Socket.IO auto-reconnects (not the initial
      // connection, which is handled in handleConnectToServer directly).
      // Reset local mute/deafen to unmuted so the UI and server stay
      // in sync after a transient network interruption.
      setIsMuted(false);
      setIsDeafened(false);
      if (currentUserId) {
        socket.emit('voice:set-muted', { userId: currentUserId, isMuted: false });
        socket.emit('voice:set-deafened', { userId: currentUserId, isDeafened: false });
      }
    });

    // user_list_update and voice:room-members-update are registered
    // directly on the socket instance in handleConnectToServer (before
    // setSocket) to avoid missing the initial broadcast. No need to
    // re-register here — doing so would create duplicate listeners.

    socket.on('user:nameColor-updated', ({ userId: updatedUserId, nameColor }) => {
      setMessages(prevMessages =>
        prevMessages.map(msg =>
          msg.userId === updatedUserId ? { ...msg, nameColor } : msg
        )
      );
    });

    socket.on('user:displayName-updated', ({ userId: updatedUserId, displayName }) => {
      setMessages(prevMessages =>
        prevMessages.map(msg =>
          msg.userId === updatedUserId ? { ...msg, displayName } : msg
        )
      );
    });

    socket.on('channel:created', (channel) => {
      loadChannels();
    });

    socket.on('channel:updated', (channelData) => {
      loadChannels();
    });

    socket.on('channel:deleted', (channelData) => {
      setSelectedChannel(prev => {
        if (prev && prev.id === channelData.id) return null;
        return prev;
      });
      loadChannels();
    });

    socket.on('channel:reordered', () => {
      loadChannels();
    });

    // Server broadcast messages from the admin console
    socket.on('server:broadcast', ({ message }) => {
      showModal(message, { title: 'Server Broadcast', type: 'alert' });
    });

    // Kicked by the admin — show reason and disconnect
    socket.on('server:kicked', ({ reason }) => {
      socket.disconnect();
      setSocket(null);
      setConnectedServer(null);
      setChannels([]);
      setMessages([]);
      setSelectedChannel(null);
      setUsers([]);
      setVoiceMembersByChannel({});
      setActiveVoiceChannel(null);
      setUnreadChannels(new Set());
      setTypingUsers({});
      showModal(reason || 'You were disconnected by the server administrator.', { title: 'Disconnected', type: 'alert' });
    });

    // Server config updated (e.g. name/icon changed via /reload)
    socket.on('server:config-update', ({ name, icon }) => {
      setConnectedServer(prev => {
        if (!prev) return prev;
        const updated = { ...prev, name: name || prev.name, icon: icon !== undefined ? icon : prev.icon };
        // Persist to saved server list
        const updatedServers = getSavedServers().map(s =>
          s.id === prev.id ? { ...s, name: updated.name, icon: updated.icon } : s
        );
        saveServerList(updatedServers);
        setServers(updatedServers);
        return updated;
      });
    });

    // Typing indicator: track who is typing per channel
    socket.on('typing:start', ({ channelId: typingChannelId, userId: typingUserId, displayName }) => {
      if (!typingChannelId || !typingUserId) return;
      const key = `${typingChannelId}:${typingUserId}`;
      setTypingUsers(prev => ({
        ...prev,
        [key]: { channelId: typingChannelId, userId: typingUserId, displayName }
      }));
      // Clear after 3s of no new typing event
      if (typingTimersRef.current[key]) clearTimeout(typingTimersRef.current[key]);
      typingTimersRef.current[key] = setTimeout(() => {
        setTypingUsers(prev => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        delete typingTimersRef.current[key];
      }, 3000);
    });

    return () => {
      socket.disconnect();
    };
  }, [socket]); // eslint-disable-line react-hooks/exhaustive-deps

  // Set up idle detection
  useEffect(() => {
    if (!socket) return; // Wait for socket to be ready
    
    let isCurrentlyIdle = false;
    const userId = localStorage.getItem('userId');

    const setIdleStatus = () => {
      if (!isCurrentlyIdle) {
        console.log('Setting user to idle (away from computer)');
        socket.emit('user:set-idle', { userId });
        isCurrentlyIdle = true;
      }
    };

    const setActiveStatus = () => {
      if (isCurrentlyIdle) {
        console.log('Setting user back to active');
        socket.emit('user:set-active', { userId });
        isCurrentlyIdle = false;
      }
    };

    // Check if running in Electron and can access system idle time
    if (window.electron && window.electron.onSystemIdleTime) {
      console.log('Using Electron system idle detection');
      // In Electron: use system idle time from powerMonitor
      window.electron.onSystemIdleTime((data) => {
        const { idleTime, threshold } = data;
        console.log(`Idle check: idleTime=${idleTime}s, threshold=${threshold}s, isIdle=${idleTime >= threshold}`);
        if (idleTime >= threshold) {
          setIdleStatus();
        } else {
          setActiveStatus();
        }
      });
    } else {
      // Fallback for web: track activity in the DRT window
      console.log('Using web-based activity tracking (Electron not available)');
      let activityTimer = null;

      const resetActivityTimer = () => {
        if (activityTimer) clearTimeout(activityTimer);
        setActiveStatus();

        activityTimer = setTimeout(() => {
          setIdleStatus();
        }, IDLE_TIMEOUT);
      };

      const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
      events.forEach(event => {
        document.addEventListener(event, resetActivityTimer, true);
      });

      setActiveStatus();
      resetActivityTimer();

      return () => {
        events.forEach(event => {
          document.removeEventListener(event, resetActivityTimer, true);
        });
        if (activityTimer) clearTimeout(activityTimer);
      };
    }
  }, [socket]);

  // loadMessages is intentionally omitted from deps: it closes over `messages`
  // state, so including it would cause an infinite reload loop.
  useEffect(() => {
    if (selectedChannel) {
      setOldestMessageRowId(null);
      loadMessages(selectedChannel.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChannel]);

  useEffect(() => {
    if (!socket || !selectedChannel) return;

    // Listen for new messages and add them to the current channel
    const handleMessageCreated = ({ channelId, message }) => {
      console.log('New message received:', message);

      // Clear typing indicator for sender
      const key = `${channelId}:${message.userId}`;
      if (typingTimersRef.current[key]) clearTimeout(typingTimersRef.current[key]);
      delete typingTimersRef.current[key];
      setTypingUsers(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });

      if (selectedChannel && selectedChannel.id === channelId) {
        setMessages(prevMessages => {
          // Check if message already exists to prevent duplicates
          if (prevMessages.some(m => m.id === message.id)) {
            console.warn('Message already in state, skipping:', message.id);
            return prevMessages;
          }
          return [...prevMessages, message];
        });
      } else {
        // Message is in a different channel than the one we're viewing
        // Mark as unread only if the sender is not us
        if (message.userId !== localStorage.getItem('userId')) {
          setUnreadChannels(prev => {
            const next = new Set(prev);
            next.add(channelId);
            return next;
          });
          // Track @mention count
          const myId = localStorage.getItem('userId');
          if (myId && message.content && message.content.includes(`<@${myId}>`)) {
            setMentionCounts(prev => ({
              ...prev,
              [channelId]: (prev[channelId] || 0) + 1
            }));
          }
        }
      }
    };

    // Listen for message updates
    const handleMessageUpdated = ({ message }) => {
      console.log('Message updated:', message);
      setMessages(prevMessages => 
        prevMessages.map(m => m.id === message.id ? { ...m, content: message.content, edited_at: message.edited_at, image: message.image } : m)
      );
    };

    // Listen for message deletions
    const handleMessageDeleted = ({ messageId, channelId }) => {
      console.log('Message deleted:', messageId);
      if (selectedChannel && selectedChannel.id === channelId) {
        setMessages(prevMessages => prevMessages.filter(m => m.id !== messageId));
      }
    };

    // Listen for user name color changes
    const handleUserNameColorUpdated = ({ userId, nameColor }) => {
      console.log('User name color updated:', userId, nameColor);
      setMessages(prevMessages =>
        prevMessages.map(m => 
          m.repliedToUserId === userId
            ? { ...m, repliedToNameColor: nameColor }
            : m
        )
      );
    };

    // Listen for reaction added
    const handleReactionAdded = ({ messageId, reactions }) => {
      console.log('Reaction added:', messageId, reactions);
      setMessages(prevMessages =>
        prevMessages.map(m =>
          m.id === messageId
            ? { ...m, reactions: reactions || [] }
            : m
        )
      );
    };

    // Listen for reaction removed
    const handleReactionRemoved = ({ messageId, reactions }) => {
      console.log('Reaction removed:', messageId, reactions);
      setMessages(prevMessages =>
        prevMessages.map(m =>
          m.id === messageId
            ? { ...m, reactions: reactions || [] }
            : m
        )
      );
    };

    socket.on('message:created', handleMessageCreated);
    socket.on('message:updated', handleMessageUpdated);
    socket.on('message:deleted', handleMessageDeleted);
    socket.on('user:nameColor-updated', handleUserNameColorUpdated);
    socket.on('reaction:added', handleReactionAdded);
    socket.on('reaction:removed', handleReactionRemoved);

    return () => {
      socket.off('message:created', handleMessageCreated);
      socket.off('message:updated', handleMessageUpdated);
      socket.off('message:deleted', handleMessageDeleted);
      socket.off('user:nameColor-updated', handleUserNameColorUpdated);
      socket.off('reaction:added', handleReactionAdded);
      socket.off('reaction:removed', handleReactionRemoved);
    };
  }, [socket, selectedChannel]);

  // Update oldestMessageRowId state for UI consistency (optional)
  useEffect(() => {
    if (messages.length > 0) {
      let oldestMsg = messages[0];
      for (let msg of messages) {
        if (msg.rowid < oldestMsg.rowid) {
          oldestMsg = msg;
        }
      }
      setOldestMessageRowId(oldestMsg.rowid);
    }
  }, [messages]);

  const loadChannels = async () => {
    try {
      const response = await channelAPI.getAllChannels();
      if (response.data.success) {
        const loadedChannels = response.data.channels;
        setChannels(loadedChannels);
        
        // Auto-select default channel: "general" text channel if exists, otherwise first text channel
        const textChannels = loadedChannels.filter(c => c.type === 'text');
        let defaultChannel = null;
        
        // Look for "general" channel first
        defaultChannel = textChannels.find(c => c.name.toLowerCase() === 'general');
        
        // If no general channel, use the first text channel
        if (!defaultChannel && textChannels.length > 0) {
          defaultChannel = textChannels[0];
        }
        
        // Set the default channel if found
        if (defaultChannel) {
          setSelectedChannel(defaultChannel);
          // Mark the auto-selected channel as read
          markChannelAsRead(defaultChannel.id);
        }
      }
    } catch (error) {
      console.error('Error loading channels:', error);
    }
  };

  const loadUsers = async () => {
    try {
      const response = await userAPI.getAllUsers();
      if (response.data.success) {
        setUsers(response.data.users);
      }
    } catch (error) {
      console.error('Error loading users:', error);
    }
  };

  const loadProfile = async () => {
    try {
      const response = await userAPI.getProfile();
      if (response.data.success) {
        setUsername(response.data.user.username);
        if (response.data.user.bio != null) {
          localStorage.setItem(`drt_bio_${accountKey}`, response.data.user.bio);
          setSettingsForm(prev => ({ ...prev, bio: response.data.user.bio }));
        }
      }
    } catch (error) {
      console.error('Error loading profile:', error);
    }
  };

  const loadUnreadChannels = async () => {
    try {
      const response = await channelAPI.getUnreadChannels();
      if (response.data.success) {
        setUnreadChannels(new Set(response.data.channelIds));
      }
    } catch (error) {
      console.error('Error loading unread channels:', error);
    }
  };

  const markChannelAsRead = async (channelId) => {
    setUnreadChannels(prev => {
      const next = new Set(prev);
      next.delete(channelId);
      return next;
    });
    setMentionCounts(prev => {
      const next = { ...prev };
      delete next[channelId];
      return next;
    });
    try {
      await channelAPI.markChannelRead(channelId);
    } catch (error) {
      console.error('Error marking channel as read:', error);
    }
  };

  const loadMessages = async (channelId, loadOlder = false) => {
    try {
      let options = {};
      
      if (loadOlder && messages.length > 0) {
        // Always calculate the actual oldest message rowid from current state
        // This prevents using a stale cursor when pagination fires quickly
        let oldestMsg = messages[0];
        for (let msg of messages) {
          if (msg.rowid < oldestMsg.rowid) {
            oldestMsg = msg;
          }
        }
        options = { beforeRowId: oldestMsg.rowid };
      }
      
      const response = await messageAPI.getMessages(channelId, 20, options);
      if (response.data.success) {
        if (!loadOlder) {
          setMessages(response.data.messages);
          if (response.data.messages.length > 0) {
            // Find the message with the minimum rowid (oldest in the batch)
            let oldestMsg = response.data.messages[0];
            for (let msg of response.data.messages) {
              if (msg.rowid < oldestMsg.rowid) {
                oldestMsg = msg;
              }
            }
            setOldestMessageRowId(oldestMsg.rowid);
          }
        } else {
          // Filter out any messages that are already in the array (to prevent duplicates from concurrent socket updates)
          setMessages(prevMessages => {
            const existingIds = new Set(prevMessages.map(m => m.id));
            const newMessagesToAdd = response.data.messages.filter(m => !existingIds.has(m.id));
            return [...newMessagesToAdd, ...prevMessages];
          });
          if (response.data.messages.length > 0) {
            // Find the message with the minimum rowid from what we're adding  
            let oldestMsg = response.data.messages[0];
            for (let msg of response.data.messages) {
              if (msg.rowid < oldestMsg.rowid) {
                oldestMsg = msg;
              }
            }
            setOldestMessageRowId(oldestMsg.rowid);

          }
        }
      }
    } catch (error) {
      console.error('Error loading messages:', error);
    }
  };

  const handleLoadMoreMessages = () => {
    if (selectedChannel) {
      loadMessages(selectedChannel.id, true);
    }
  };

  const handleCreateChannel = async (e) => {
    e.preventDefault();
    try {
      const response = await channelAPI.createChannel(
        newChannelData.name,
        newChannelData.description,
        newChannelData.type
      );
      if (response.data.success) {
        const newChannel = response.data.channel;
        await loadChannels();
        // Auto-focus the newly created channel (after loadChannels completes)
        setSelectedChannel(newChannel);
        setNewChannelData({ name: '', description: '', type: 'text' });
        setShowCreateChannel(false);
      }
    } catch (error) {
      console.error('Error creating channel:', error);
    }
  };

  const handleSendMessage = async (messageData) => {
    if (!selectedChannel) return;
    try {
      const content = (messageData.text || '').trim() ? messageData.text : '';
      const images = messageData.images ? messageData.images : null;
      const replyTo = messageData.replyTo || null;
      
      // Ensure we have either content or images
      if (!content && !images) {
        console.warn('No content or image to send');
        return;
      }

      // Sign message if identity keys are available
      let signature = null;
      let signingPayload = null;
      if (identityKeys && identityKeys.privateKey) {
        const timestamp = new Date().toISOString();
        signingPayload = createMessageSigningPayload(content, selectedChannel.id, timestamp);
        signature = await signData(signingPayload, identityKeys.privateKey);
      }
      
      await messageAPI.sendMessage(selectedChannel.id, content, images, replyTo, signature, signingPayload);
    } catch (error) {
      console.error('Error sending message:', error);
    }
  };

  const handleAddReaction = async (messageId, emoji) => {
    try {
      await reactionAPI.addReaction(messageId, emoji);
    } catch (error) {
      console.error('Error adding reaction:', error);
    }
  };

  const handleRemoveReaction = async (messageId, emoji) => {
    try {
      await reactionAPI.removeReaction(messageId, emoji);
    } catch (error) {
      console.error('Error removing reaction:', error);
    }
  };

  const handleChannelSelect = (channel) => {
    console.log('handleChannelSelect called with:', channel);
    if (channel.type === 'voice') {
      // Auto-join voice channel
      console.log('Setting active voice channel to:', channel.id);
      setActiveVoiceChannel(channel);
    } else {
      // For text channels, just set as selected for viewing
      console.log('Setting selected text channel to:', channel.id);
      setSelectedChannel(channel);
      // Mark channel as read and remove from unread set
      markChannelAsRead(channel.id);
    }
  };

  const handleLeaveVoice = () => {
    console.log('Leaving voice channel');
    setActiveVoiceChannel(null);
  };

  const closeSettings = () => {
    setSettingsForm({
      displayName: userDisplayName,
      nameColor: localStorage.getItem(`drt_nameColor_${accountKey}`) || '#a78bba',
      bio: localStorage.getItem(`drt_bio_${accountKey}`) || '',
      profilePicture: undefined,
    });
    setShowSettings(false);
  };

  const handleSaveSettings = async () => {
    try {
      // Always persist locally first
      if (settingsForm.displayName !== userDisplayName) {
        localStorage.setItem(`drt_displayName_${accountKey}`, settingsForm.displayName);
        localStorage.setItem('drt_displayName', settingsForm.displayName);
        setUserDisplayName(settingsForm.displayName);

        // Sync to server only if connected
        if (connectedServer) {
          const response = await userAPI.updateDisplayName(settingsForm.displayName);
          const finalDisplayName = response.data.displayName;
          setUserDisplayName(finalDisplayName);
          localStorage.setItem(`drt_displayName_${accountKey}`, finalDisplayName);
          localStorage.setItem('drt_displayName', finalDisplayName);
        }
      }
      
      const savedNameColor = localStorage.getItem(`drt_nameColor_${accountKey}`) || '#a78bba';
      if (settingsForm.nameColor !== savedNameColor) {
        localStorage.setItem(`drt_nameColor_${accountKey}`, settingsForm.nameColor);
        setUserNameColor(settingsForm.nameColor);

        // Sync to server only if connected
        if (connectedServer) {
          await userAPI.updateNameColor(settingsForm.nameColor);
        }
      }

      const savedBio = localStorage.getItem(`drt_bio_${accountKey}`) || '';
      if (settingsForm.bio !== savedBio) {
        localStorage.setItem(`drt_bio_${accountKey}`, settingsForm.bio);

        if (connectedServer) {
          await userAPI.updateBio(settingsForm.bio);
        }
      }

      // Save profile picture if changed
      if (settingsForm.profilePicture !== undefined) {
        setProfilePicture(settingsForm.profilePicture);
        localStorage.setItem(`drt_profilePicture_${accountKey}`, settingsForm.profilePicture);
        if (connectedServer) {
          userAPI.updateProfilePicture(settingsForm.profilePicture).catch(err =>
            console.error('Failed to save profile picture to backend:', err)
          );
        }
      }
      
      setShowSettings(false);
    } catch (error) {
      console.error('Error updating settings:', error);
      showModal('Failed to update settings on server. Changes saved locally and will sync on reconnect.', { title: 'Settings' });
      setShowSettings(false);
    }
  };

  const handleExportBackup = async () => {
    try {
      const storedIdentity = localStorage.getItem('drt_identity');
      if (!storedIdentity) {
        showModal('No identity data to export', { title: 'Export Backup' });
        return;
      }
      const identityData = JSON.parse(storedIdentity);
      const blob = JSON.parse(createBackupBlob(identityData));

      if (window.electron && window.electron.exportBackup) {
        const result = await window.electron.exportBackup(blob);
        if (result.success) {
          showModal('Backup exported successfully!', { title: 'Export Backup' });
        }
      } else {
        // Fallback for non-Electron: download as file
        const dataStr = JSON.stringify(blob, null, 2);
        const el = document.createElement('a');
        el.setAttribute('href', 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr));
        el.setAttribute('download', 'drt-identity-backup.json');
        el.click();
      }
    } catch (err) {
      console.error('Export backup error:', err);
      showModal('Failed to export backup: ' + err.message, { title: 'Export Error' });
    }
  };

  const handleToggleServerBackup = async () => {
    const newVal = !serverBackupEnabled;
    setServerBackupEnabled(newVal);
    localStorage.setItem('drt_serverBackup', newVal.toString());
    if (newVal) {
      // Upload backup blob to server
      try {
        const storedIdentity = localStorage.getItem('drt_identity');
        if (storedIdentity) {
          const identityData = JSON.parse(storedIdentity);
          const blob = createBackupBlob(identityData);
          await identityAPI.uploadBackupBlob(blob);
        }
      } catch (err) {
        console.warn('Failed to upload backup to server:', err.message);
      }
    }
  };

  const identityPublicKey = (() => {
    try {
      const stored = localStorage.getItem('drt_identity');
      if (stored) {
        const id = JSON.parse(stored);
        return id.identityPublicKey || 'Unknown';
      }
    } catch {}
    return 'Unknown';
  })();

  const handleProfilePictureChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImageDataToEdit(reader.result);
        setShowImageCropper(true);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleImageCropComplete = (croppedImage) => {
    setSettingsForm(prev => ({ ...prev, profilePicture: croppedImage }));
    setShowImageCropper(false);
    setImageDataToEdit(null);
  };

  useEffect(() => {
    console.log('Main.js: activeVoiceChannel updated to:', activeVoiceChannel);
  }, [activeVoiceChannel]);

  // Pause GIFs when application loses focus
  useEffect(() => {
    const pausedCanvases = new Map(); // Track which images have paused canvases
    let windowFocused = document.hasFocus(); // Track current focus state
    let observer = null; // MutationObserver for new GIFs added while unfocused

    const isGifSrc = (src) => src && (src.includes('.gif') || src.includes('data:image/gif'));

    const pauseGifImg = (img) => {
      if (!isGifSrc(img.src)) return;
      try {
        if (img.complete) {
          captureAndPauseGif(img);
        } else {
          img.onload = () => captureAndPauseGif(img);
        }
      } catch (e) {
        console.log('Could not pause GIF:', e);
      }
    };

    const startObserver = () => {
      if (observer) return;
      observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            // Check if the added node itself is a GIF image
            if (node.tagName === 'IMG') {
              pauseGifImg(node);
            }
            // Check children of the added node for GIF images
            const imgs = node.querySelectorAll ? node.querySelectorAll('img') : [];
            imgs.forEach(pauseGifImg);
          }
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    };

    const stopObserver = () => {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
    };

    const handleFocusChange = (isVisible) => {
      windowFocused = isVisible;
      if (!isVisible) {
        // Window lost focus or tab was switched - pause all GIFs
        const imageElements = document.querySelectorAll('img');
        imageElements.forEach(pauseGifImg);
        // Start watching for new GIF images added while unfocused
        startObserver();
      } else {
        // Stop watching for new images
        stopObserver();
        // Window gained focus - resume all GIFs
        pausedCanvases.forEach((canvas, img) => {
          if (canvas && canvas.parentNode) {
            canvas.parentNode.removeChild(canvas);
            img.style.display = '';
          }
        });
        pausedCanvases.clear();
      }
    };

    const captureAndPauseGif = (img) => {
      // If already paused, remove the existing canvas first
      if (pausedCanvases.has(img)) {
        const existingCanvas = pausedCanvases.get(img);
        if (existingCanvas && existingCanvas.parentNode) {
          existingCanvas.parentNode.removeChild(existingCanvas);
        }
        pausedCanvases.delete(img);
      }

      // Check if there's already a canvas right after this image (from a previous pause attempt)
      if (img.nextSibling && img.nextSibling.tagName === 'CANVAS') {
        const existingCanvas = img.nextSibling;
        if (existingCanvas.parentNode) {
          existingCanvas.parentNode.removeChild(existingCanvas);
        }
      }

      try {
        const width = img.naturalWidth || img.width;
        const height = img.naturalHeight || img.height;

        if (width > 0 && height > 0) {
          // Get computed style of original image
          const computedStyle = window.getComputedStyle(img);
          
          // Create canvas with same dimensions and styling as image
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          
          // Copy all relevant styles from the original image
          canvas.style.maxWidth = computedStyle.maxWidth;
          canvas.style.maxHeight = computedStyle.maxHeight;
          canvas.style.width = computedStyle.width;
          canvas.style.height = computedStyle.height;
          canvas.style.borderRadius = computedStyle.borderRadius;
          canvas.style.display = 'block';
          canvas.style.margin = computedStyle.margin;
          canvas.style.padding = computedStyle.padding;
          canvas.className = img.className;

          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          // Insert canvas right after the image
          img.parentNode.insertBefore(canvas, img.nextSibling);

          // Hide the image, show the canvas
          img.style.display = 'none';
          canvas.style.opacity = '0.8';

          // Store the canvas for later
          pausedCanvases.set(img, canvas);
        }
      } catch (e) {
        console.log('Error creating pause canvas:', e);
      }
    };

    const onBlur = () => handleFocusChange(false);
    const onFocus = () => handleFocusChange(true);
    const onVisibilityChange = () => handleFocusChange(!document.hidden);
    
    // Listen for both window blur/focus (clicking away) and visibility change (tab switching)
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);

    // If app starts unfocused, begin observing immediately
    if (!windowFocused) {
      startObserver();
    }
    
    return () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      stopObserver();
      
      // Cleanup canvases on unmount
      pausedCanvases.forEach((canvas) => {
        if (canvas && canvas.parentNode) {
          canvas.parentNode.removeChild(canvas);
        }
      });
      pausedCanvases.clear();
    };
  }, []);

  return (
    <div className="main-container">
      {showImageCropper && imageDataToEdit && (
        <ImageCropper
          imageData={imageDataToEdit}
          onCropComplete={handleImageCropComplete}
          onCancel={() => {
            setShowImageCropper(false);
            setImageDataToEdit(null);
          }}
        />
      )}

      {showColorPicker && (
        <ColorPicker
          color={settingsForm.nameColor}
          onSave={(hex) => {
            setSettingsForm(prev => ({ ...prev, nameColor: hex }));
            setShowColorPicker(false);
          }}
          onClose={() => setShowColorPicker(false)}
        />
      )}

      {/* ── Fixed logo (never moves) ─────────────────────────────── */}
      <button className="main-logo-btn" onClick={handleLogoClick} title={serverListOpen ? 'Collapse server list' : 'Expand server list'}>
        <img src="./images/logo.png" alt="DRT" className="main-logo-img" />
      </button>

      {/* ── Server List Bar (hidden when collapsed) ────────────────── */}
      {serverListOpen && (
        <ServerList
          servers={servers}
          connectedServer={connectedServer}
          onSelectServer={handleConnectToServer}
          onAddServer={handleAddServer}
          onRemoveServer={handleRemoveServer}
          onChangeServerUrl={handleChangeServerUrl}
          isConnecting={connectingServer}
        />
      )}

      {/* ── Sidebar (always visible) ──────────────────────────────── */}
      <aside className={`sidebar${serverListOpen ? '' : ' no-server-bar'}`}>
        <div className="sidebar-header">
          <h2>{connectedServer ? (connectedServer.name || 'DRT') : 'DRT'}</h2>
        </div>

        {connectedServer && (
          <>

            <div className="channels-section">
              <div className="channels-header">
                <h3>Channels</h3>
                <button
                  onClick={() => setShowCreateChannel(!showCreateChannel)}
                  className="create-channel-btn"
                >
                  +
                </button>
              </div>

              {showCreateChannel && (
                <form onSubmit={handleCreateChannel} className="create-channel-form">
                  <input
                    type="text"
                    placeholder="Channel name"
                    value={newChannelData.name}
                    onChange={(e) => setNewChannelData({ ...newChannelData, name: e.target.value })}
                    required
                  />
                  {newChannelData.type === 'text' && (
                    <input
                      type="text"
                      placeholder="Description"
                      value={newChannelData.description}
                      onChange={(e) => setNewChannelData({ ...newChannelData, description: e.target.value })}
                    />
                  )}
                  <select
                    value={newChannelData.type}
                    onChange={(e) => setNewChannelData({ ...newChannelData, type: e.target.value })}
                  >
                    <option value="text">Text Channel</option>
                    <option value="voice">Voice Channel</option>
                  </select>
                  <button type="submit">Create</button>
                </form>
              )}

              <ChannelList
                channels={channels}
                selectedChannel={selectedChannel}
                onSelectChannel={handleChannelSelect}
                voiceMembersByChannel={voiceMembersByChannel}
                activeVoiceChannel={activeVoiceChannel}
                onChannelsChanged={loadChannels}
                speakingUsers={speakingUsers}
                selectedUserForControl={selectedUserForControl}
                onSelectUserForControl={setSelectedUserForControl}
                userVolumes={userVolumes}
                userMutes={userMutes}
                onVolumeChange={handleVolumeChange}
                onToggleMute={handleToggleMuteUser}
                currentUserId={localStorage.getItem('userId')}
                unreadChannels={unreadChannels}
                mentionCounts={mentionCounts}
              />
            </div>
          </>
        )}

        {activeVoiceChannel && (
          <div className="sidebar-footer">
            <div className="voice-call-bar">
              <div className="voice-call-info">
                <span className="voice-channel-name"><Twemoji emoji="🔊" size={16} /> {activeVoiceChannel.name}</span>
              </div>
              <div className="voice-call-controls">
                <button
                  onClick={handleToggleMute}
                  className={`voice-btn ${isMuted ? 'muted' : ''}`}
                  title={isMuted ? "Unmute" : "Mute"}
                >
                  {isMuted ? <Twemoji emoji="🔇" size={18} /> : <Twemoji emoji="🎤" size={18} />}
                </button>
                <button
                  onClick={handleToggleDeafen}
                  className={`voice-btn ${isDeafened ? 'deafened' : ''}`}
                  title={isDeafened ? "Undeafen" : "Deafen"}
                >
                  {isDeafened ? <Twemoji emoji="🔕" size={18} /> : <Twemoji emoji="🔊" size={18} />}
                </button>
                <button onClick={handleLeaveVoice} className="hangup-btn" title="Leave Voice">
                  <Twemoji emoji="📞" size={18} />
                </button>
              </div>
            </div>
          </div>
        )}
      </aside>

      {/* ── User panel — overlays server bar + sidebar bottom ─────── */}
      <div className={`user-panel${serverListOpen ? ' server-open' : ''}`}>
        <div className="user-avatar-small">
          {profilePicture ? (
            <img src={profilePicture} alt="Profile" />
          ) : (
            <div className="user-avatar-small-initial">{userDisplayName.charAt(0).toUpperCase()}</div>
          )}
        </div>
        <div className="user-info">
          <span className="user-name" style={{ color: normalizeNameColor(userNameColor) }}>{userDisplayName}</span>
        </div>
        <button onClick={() => { if (!showSettings) setSettingsTab('user'); setShowSettings(!showSettings); }} className="settings-btn" title="Settings">
          <Twemoji emoji="⚙️" size={18} />
        </button>
      </div>

      {/* ── Settings Modal (always accessible) ─────────────────────── */}
      {showSettings && (
        <>
          <div className="settings-backdrop" onClick={closeSettings} />
          <div className="settings-modal-container">
            <div className="settings-modal-content">
              <button className="settings-modal-close" onClick={closeSettings}>×</button>

              <div className="settings-modal-layout">
                <div className="settings-tab-sidebar">
                  <button
                    className={`settings-tab-btn${settingsTab === 'user' ? ' active' : ''}`}
                    onClick={() => setSettingsTab('user')}
                  >
                    User Settings
                  </button>
                  <button
                    className={`settings-tab-btn${settingsTab === 'identity' ? ' active' : ''}`}
                    onClick={() => setSettingsTab('identity')}
                  >
                    Identity &amp; Security
                  </button>
                  <button
                    className={`settings-tab-btn${settingsTab === 'voice' ? ' active' : ''}`}
                    onClick={() => setSettingsTab('voice')}
                  >
                    Voice
                  </button>
                  <button
                    className={`settings-tab-btn${settingsTab === 'updates' ? ' active' : ''}`}
                    onClick={() => setSettingsTab('updates')}
                  >
                    Updates
                    {updateInfo && updateStatus !== 'up-to-date' && (
                      <span className="update-badge">1</span>
                    )}
                  </button>
                </div>

                <div className="settings-tab-content">
                  {settingsTab === 'user' && (
                    <>
                      <div className="settings-tab-content-scrollable">
                      <div className="settings-profile-section">
                        <div className="settings-avatar">
                          {(settingsForm.profilePicture !== undefined ? settingsForm.profilePicture : profilePicture) ? (
                            <img src={settingsForm.profilePicture !== undefined ? settingsForm.profilePicture : profilePicture} alt="Profile" />
                          ) : (
                            <div className="settings-avatar-placeholder">{userDisplayName.charAt(0).toUpperCase()}</div>
                          )}
                        </div>
                        <div className="settings-upload">
                          <label htmlFor="profile-picture-input" className="settings-upload-btn">
                            Change Avatar
                          </label>
                          <input
                            id="profile-picture-input"
                            type="file"
                            accept="image/*"
                            onChange={handleProfilePictureChange}
                            style={{ display: 'none' }}
                          />
                        </div>
                      </div>

                      <div className="settings-form-section">
                        <label className="settings-label">Username</label>
                        <input
                          type="text"
                          value={username}
                          readOnly
                          className="settings-input"
                          style={{ opacity: 0.7, cursor: 'not-allowed' }}
                        />
                      </div>

                      <div className="settings-form-section">
                        <label className="settings-label">Display Name</label>
                        <input
                          type="text"
                          value={settingsForm.displayName}
                          onChange={(e) => setSettingsForm({ ...settingsForm, displayName: e.target.value })}
                          className="settings-input"
                          placeholder="Enter display name"
                        />
                      </div>

                      <div className="settings-form-section">
                        <label className="settings-label">Name Color</label>
                        <div className="settings-color-picker-container">
                          <button
                            className="settings-color-swatch-btn"
                            style={{ backgroundColor: settingsForm.nameColor }}
                            onClick={() => setShowColorPicker(true)}
                            title="Pick a color"
                          />
                          <span className="color-preview" style={{ backgroundColor: settingsForm.nameColor }}></span>
                        </div>
                      </div>

                      <div className="settings-form-section">
                        <label className="settings-label">About Me</label>
                        <textarea
                          value={settingsForm.bio}
                          onChange={(e) => setSettingsForm({ ...settingsForm, bio: e.target.value.slice(0, 500) })}
                          className="settings-input"
                          placeholder="Tell others about yourself"
                          rows={3}
                          maxLength={500}
                          style={{ resize: 'vertical', minHeight: '60px' }}
                        />
                      </div>

                      </div>

                      <div className="settings-actions">
                        <button onClick={handleSaveSettings} className="settings-save-btn">
                          Save Changes
                        </button>
                        <button onClick={() => setShowProfilePreview(true)} className="settings-preview-btn">
                          Preview
                        </button>
                        <button onClick={() => { setShowSettings(false); onLogout(); }} className="settings-logout-btn">
                          Logout
                        </button>
                      </div>
                    </>
                  )}

                  {settingsTab === 'identity' && (
                    <>
                      <div className="settings-form-section">
                        <label className="settings-label">Public Key</label>
                        <div
                          className={`settings-pubkey-box${copiedPubKey ? ' copied' : ''}`}
                          onClick={() => {
                            navigator.clipboard.writeText(identityPublicKey).then(() => {
                              setCopiedPubKey(true);
                              setTimeout(() => setCopiedPubKey(false), 2000);
                            }).catch(() => {});
                          }}
                          style={{ cursor: 'pointer', overflowWrap: 'break-word', wordBreak: 'break-all', userSelect: 'none' }}
                          title="Click to copy"
                        >
                          {copiedPubKey ? 'Copied to clipboard!' : identityPublicKey}
                        </div>
                      </div>

                      <div className="settings-form-section">
                        <label className="settings-label">Server</label>
                        {connectedServer ? (
                          <div style={{ fontSize: '13px', color: '#e9d5ff', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{
                              display: 'inline-block',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              fontSize: '11px',
                              fontWeight: 600,
                              letterSpacing: '0.5px',
                              backgroundColor: connectedServer.url.startsWith('https://') ? '#166534' : '#854d0e',
                              color: connectedServer.url.startsWith('https://') ? '#4ade80' : '#fbbf24',
                            }}>
                              {connectedServer.url.startsWith('https://') ? <><Twemoji emoji="🔒" size={12} /> HTTPS</> : 'HTTP'}
                            </span>
                            <span>{connectedServer.url.replace(/^https?:\/\//, '')}</span>
                          </div>
                        ) : (
                          <div style={{ fontSize: '13px', color: '#6b5b7b' }}>Not connected</div>
                        )}
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                        <button onClick={handleExportBackup} className="settings-identity-btn">
                          <Twemoji emoji="📁" size={14} /> Export Encrypted Backup
                        </button>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#e9d5ff', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={serverBackupEnabled}
                            onChange={handleToggleServerBackup}
                            style={{ accentColor: '#9d43e1' }}
                          />
                          Auto-upload encrypted backup to server
                        </label>
                        <p style={{ fontSize: '11px', color: '#6b5b7b', margin: '4px 0 0 0' }}>
                          The backup is encrypted with your recovery seed. The server cannot decrypt it.
                        </p>
                      </div>
                    </>
                  )}

                  {settingsTab === 'voice' && (
                    <VoiceSettings />
                  )}

                  {settingsTab === 'updates' && (
                    <>
                      <div className="settings-form-section">
                        <label className="settings-label">Current Version</label>
                        <div style={{ fontSize: '14px', color: '#e9d5ff' }}>{appVersion || 'Unknown'}</div>
                      </div>

                      <div className="settings-form-section">
                        <label className="settings-label">Automatic Updates</label>
                        <label className="update-toggle-label">
                          <input
                            type="checkbox"
                            checked={autoUpdateEnabled}
                            onChange={async (e) => {
                              const val = e.target.checked;
                              setAutoUpdateEnabled(val);
                              if (window.electron) await window.electron.setAutoUpdateEnabled(val);
                            }}
                            style={{ accentColor: '#9d43e1' }}
                          />
                          Automatically check for updates (every 24 hours)
                        </label>
                      </div>

                      <div className="settings-form-section">
                        <label className="settings-label">Check for Updates</label>
                        <button
                          className="settings-identity-btn"
                          disabled={updateStatus === 'checking' || updateStatus === 'downloading' || updateStatus === 'installing'}
                          onClick={async () => {
                            if (!window.electron) return;
                            setUpdateStatus('checking');
                            setUpdateError('');
                            setUpdateInfo(null);
                            try {
                              const result = await window.electron.checkForUpdates();
                              if (result.error) {
                                setUpdateStatus('error');
                                setUpdateError(result.error);
                              } else if (result.upToDate) {
                                setUpdateStatus('up-to-date');
                              } else if (result.update) {
                                setUpdateInfo(result.update);
                                setUpdateStatus('idle');
                              }
                            } catch (e) {
                              setUpdateStatus('error');
                              setUpdateError(e.message);
                            }
                          }}
                        >
                          {updateStatus === 'checking' ? <><Twemoji emoji="⏳" size={14} /> Checking...</> : <><Twemoji emoji="🔄" size={14} /> Check for Updates</>}
                        </button>
                      </div>

                      {updateStatus === 'up-to-date' && (
                        <div className="update-status-box update-status-ok">
                          <Twemoji emoji="✅" size={14} /> You are running the latest version.
                        </div>
                      )}

                      {updateStatus === 'error' && updateError && (
                        <div className="update-status-box update-status-err">
                          <Twemoji emoji="❌" size={14} /> {updateError}
                        </div>
                      )}

                      {updateInfo && updateStatus !== 'up-to-date' && (
                        <div className="update-available-box">
                          <div className="update-available-header">
                            <span><Twemoji emoji="🎉" size={14} /> Update available:</span>
                            <strong style={{ marginLeft: '6px' }}>{updateInfo.releaseName}</strong>
                          </div>
                          <div style={{ fontSize: '13px', color: '#a78bba', margin: '4px 0 8px' }}>
                            {appVersion} → {updateInfo.version}
                          </div>

                          {updateInfo.releaseNotes && (
                            <div className="update-release-notes">
                              <label className="settings-label">Release Notes</label>
                              <pre className="update-release-notes-body">{updateInfo.releaseNotes}</pre>
                            </div>
                          )}

                          {updateStatus === 'downloading' && (
                            <div style={{ margin: '12px 0' }}>
                              <div className="update-progress-bar">
                                <div className="update-progress-fill" style={{ width: `${updateProgress}%` }} />
                              </div>
                              <div style={{ fontSize: '12px', color: '#a78bba', marginTop: '4px' }}>Downloading... {updateProgress}%</div>
                            </div>
                          )}

                          {updateStatus === 'ready' && (
                            <div className="update-status-box update-status-ok">
                              <Twemoji emoji="✅" size={14} /> Download complete &amp; verified. Ready to install.
                            </div>
                          )}

                          {updateStatus === 'installing' && (
                            <div className="update-status-box update-status-ok">
                              <Twemoji emoji="⏳" size={14} /> Launching installer... The app will close and restart.
                            </div>
                          )}

                          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                            {(updateStatus === 'idle' || updateStatus === 'error') && (
                              <button
                                className="settings-save-btn"
                                onClick={async () => {
                                  if (!window.electron) return;
                                  setUpdateStatus('downloading');
                                  setUpdateProgress(0);
                                  setUpdateError('');
                                  try {
                                    const result = await window.electron.downloadUpdate(updateInfo);
                                    if (result.error) {
                                      setUpdateStatus('error');
                                      setUpdateError(result.error);
                                    } else {
                                      setDownloadedMsiPath(result.msiPath);
                                      setUpdateStatus('ready');
                                    }
                                  } catch (e) {
                                    setUpdateStatus('error');
                                    setUpdateError(e.message);
                                  }
                                }}
                              >
                                <Twemoji emoji="⬇️" size={14} /> Download Update
                              </button>
                            )}

                            {updateStatus === 'ready' && downloadedMsiPath && (
                              <button
                                className="settings-save-btn"
                                onClick={async () => {
                                  if (!window.electron) return;
                                  setUpdateStatus('installing');
                                  try {
                                    await window.electron.installUpdate(downloadedMsiPath);
                                  } catch (e) {
                                    setUpdateStatus('error');
                                    setUpdateError(e.message);
                                  }
                                }}
                              >
                                <Twemoji emoji="🚀" size={14} /> Install &amp; Restart
                              </button>
                            )}

                            {updateInfo.htmlUrl && (
                              <button
                                className="settings-identity-btn"
                                onClick={() => window.open(updateInfo.htmlUrl, '_blank')}
                                style={{ flex: 'unset' }}
                              >
                                View on GitHub
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Profile modal (popover from user list click) */}
      <ProfileModal
        isOpen={!!profileModalUser}
        user={profileModalUser}
        position={profileModalPosition}
        onClose={() => { setProfileModalUser(null); setProfileModalPosition(null); }}
      />

      {/* Profile preview (centered, from settings) */}
      <ProfileModal
        isOpen={showProfilePreview}
        user={{
          id: localStorage.getItem('userId'),
          displayName: settingsForm.displayName || userDisplayName,
          username,
          nameColor: settingsForm.nameColor || userNameColor,
          profilePicture: settingsForm.profilePicture !== undefined ? settingsForm.profilePicture : profilePicture,
          status: 'online',
          bio: settingsForm.bio,
        }}
        position={null}
        onClose={() => setShowProfilePreview(false)}
      />

      {/* ── Content Area ──────────────────────────────────────────── */}
      {connectedServer ? (
        <>
          <main className="content">
            {activeVoiceChannel && (
              <VoiceArea 
                socket={socket} 
                channel={activeVoiceChannel} 
                onLeave={handleLeaveVoice} 
                onSpeakingChange={setSpeakingUsers} 
                isMuted={isMuted} 
                isDeafened={isDeafened}
                voiceMembers={voiceMembersByChannel[activeVoiceChannel.id] || []}
                currentUserId={localStorage.getItem('userId')}
                selectedUserForControl={selectedUserForControl}
                onSelectUserForControl={setSelectedUserForControl}
                userVolumes={userVolumes}
                userMutes={userMutes}
                onVolumeChange={handleVolumeChange}
                onToggleMute={handleToggleMuteUser}
              />
            )}
            {selectedChannel && selectedChannel.type === 'text' ? (
              <>
                <div className="channel-header">
                  <h2>{selectedChannel.name}</h2>
                  {selectedChannel.description && <p>{selectedChannel.description}</p>}
                </div>
                <MessageArea
                  messages={messages}
                  onSendMessage={handleSendMessage}
                  onLoadMoreMessages={handleLoadMoreMessages}
                  channelId={selectedChannel.id}
                  currentUserId={localStorage.getItem('userId')}
                  onAddReaction={handleAddReaction}
                  onRemoveReaction={handleRemoveReaction}
                  accountKey={accountKey}
                  socket={socket}
                  typingUsers={Object.fromEntries(
                    Object.entries(typingUsers).filter(
                      ([, v]) => v.channelId === selectedChannel.id && v.userId !== localStorage.getItem('userId')
                    )
                  )}
                  users={users}
                />
              </>
            ) : (
              <div className="no-channel-selected">
                <h2>Select a channel to get started</h2>
              </div>
            )}
          </main>

          <UserList users={users} onUserClick={(user, e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setProfileModalUser(user);
            setProfileModalPosition({ x: rect.left, y: rect.top });
          }} />
        </>
      ) : (
        /* ── Empty State (no server connected) ──────────────────── */
        <div className="no-server-container">
          <div className="no-server-content">
            <h2>Welcome to DRT</h2>
            {connectingServer ? (
              <div className="no-server-status">
                <div className="connecting-spinner" />
                <p>Connecting to server...</p>
              </div>
            ) : serverError ? (
              <div className="no-server-status">
                <p className="server-error-msg">{serverError}</p>
                <button className="server-retry-btn" onClick={() => lastAttemptedServer && handleConnectToServer(lastAttemptedServer)}>Retry</button>
              </div>
            ) : (
              <p className="no-server-hint">
                {servers.length === 0
                  ? 'Click the + button in the server list to add your first server'
                  : 'Select a server from the list to connect'}
              </p>
            )}
          </div>
        </div>
      )}
      <CustomModal
        isOpen={modalInfo.open}
        title={modalInfo.title}
        message={modalInfo.message}
        type={modalInfo.type}
        onConfirm={() => closeModal(true)}
        onCancel={() => closeModal(false)}
      />
    </div>
  );
}

export default Main;
