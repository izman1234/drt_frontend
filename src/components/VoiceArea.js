import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  createAudioFilters,
  getUserMediaConstraints,
  subscribeToPipelineUpdates,
  createRemoteAudioChain,
  volumeToGain,
} from '../audioEngine';
import { loadVoiceSettings } from '../voiceSettings';
import {
  getCameraConstraints,
  getScreenConstraints,
  loadVideoSettings,
  onVideoSettingsChange,
} from '../videoSettings';
import CallStage, { FloatingCallWindow } from './CallStage';
import ScreenSharePicker from './ScreenSharePicker';
import './VoiceArea.css';

const ICE_SERVERS = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

function findMemberBySocket(members, socketId) {
  return (members || []).find(member => member.socketId === socketId);
}

function normalizeMediaStates(states) {
  const map = {};
  (states || []).forEach((state) => {
    if (!state.userId) return;
    map[state.userId] = {
      userId: state.userId,
      socketId: state.socketId,
      cameraOn: !!state.cameraOn,
      screenOn: !!state.screenOn,
    };
  });
  return map;
}

const VoiceArea = forwardRef(function VoiceArea({
  socket,
  channel,
  onLeave,
  onSpeakingChange,
  isMuted,
  isDeafened,
  voiceMembers = [],
  currentUserId,
  selectedUserForControl,
  onSelectUserForControl,
  userVolumes,
  userMutes,
  onVolumeChange,
  onToggleMute,
  showCallStage = false,
  showFloatingCall = false,
  onRestoreCall,
  onMinimizeCall,
  onMediaStatesChange,
  onLocalMediaStateChange,
  onToggleMuteSelf,
  onToggleDeafenSelf,
}, ref) {
  const localStreamRef = useRef(null);
  const localCameraStreamRef = useRef(null);
  const localScreenStreamRef = useRef(null);
  const peersRef = useRef({});
  const sendersRef = useRef({});
  const makingOfferRef = useRef({});
  const pendingNegotiationRef = useRef({});
  const audioElementsRef = useRef({});
  const analyserRef = useRef({});
  const dataArrayRef = useRef({});
  const remoteSpeakingRef = useRef({});
  const audioContextRef = useRef(null);
  const remoteAudioContextRef = useRef(null);
  const audioFiltersRef = useRef({});
  const remoteGainNodesRef = useRef({});
  const isMutedRef = useRef(isMuted);
  const currentMuteStateRef = useRef(isMuted);
  const speakingDetectionRef = useRef(null);
  const voiceMembersRef = useRef(voiceMembers);
  const userVolumesRef = useRef(userVolumes || {});
  const userMutesRef = useRef(userMutes || {});
  const isDeafenedRef = useRef(isDeafened);
  const peerUserIdsRef = useRef({});
  const isJoinedRef = useRef(false);
  const handlersRef = useRef({});
  const onSpeakingChangeRef = useRef(onSpeakingChange);
  const channelRef = useRef(channel);
  const trackMetadataRef = useRef({});
  const screenWatchersRef = useRef(new Set());
  const localMediaStateRef = useRef({ cameraOn: false, screenOn: false });
  const onMediaStatesChangeRef = useRef(onMediaStatesChange);
  const onLocalMediaStateChangeRef = useRef(onLocalMediaStateChange);

  const [speakingMap, setSpeakingMap] = useState({});
  const [mediaStates, setMediaStates] = useState({});
  const [localMediaState, setLocalMediaState] = useState({ cameraOn: false, screenOn: false });
  const [localVideoStreams, setLocalVideoStreams] = useState({ camera: null, screen: null });
  const [remoteVideoStreams, setRemoteVideoStreams] = useState({});
  const [focusedTile, setFocusedTile] = useState(null);
  const [selectedScreenUserId, setSelectedScreenUserId] = useState(null);
  const [showScreenPicker, setShowScreenPicker] = useState(false);
  const [mediaError, setMediaError] = useState('');
  const [videoSettings, setVideoSettings] = useState(loadVideoSettings);

  useEffect(() => {
    isMutedRef.current = isMuted;
    currentMuteStateRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => { voiceMembersRef.current = voiceMembers; }, [voiceMembers]);
  useEffect(() => { userVolumesRef.current = userVolumes || {}; }, [userVolumes]);
  useEffect(() => { userMutesRef.current = userMutes || {}; }, [userMutes]);
  useEffect(() => { isDeafenedRef.current = isDeafened; }, [isDeafened]);
  useEffect(() => { onSpeakingChangeRef.current = onSpeakingChange; }, [onSpeakingChange]);
  useEffect(() => { channelRef.current = channel; }, [channel]);
  useEffect(() => { onMediaStatesChangeRef.current = onMediaStatesChange; }, [onMediaStatesChange]);
  useEffect(() => { onLocalMediaStateChangeRef.current = onLocalMediaStateChange; }, [onLocalMediaStateChange]);

  useEffect(() => onVideoSettingsChange(setVideoSettings), []);

  useEffect(() => {
    const unsub = subscribeToPipelineUpdates({
      filtersRef: audioFiltersRef,
      remoteGainNodesRef,
      localStreamRef,
      audioContextRef,
      peersRef,
      audioElementsRef,
      analyserRef,
      dataArrayRef,
      isMutedRef,
    });
    return unsub;
  }, []);

  useEffect(() => {
    const resumeOnInteraction = () => {
      const ctx = remoteAudioContextRef.current;
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    };
    document.addEventListener('click', resumeOnInteraction, { capture: true });
    document.addEventListener('keydown', resumeOnInteraction, { capture: true });
    return () => {
      document.removeEventListener('click', resumeOnInteraction, { capture: true });
      document.removeEventListener('keydown', resumeOnInteraction, { capture: true });
    };
  }, []);

  function getPeerSenders(peerSocketId) {
    if (!sendersRef.current[peerSocketId]) sendersRef.current[peerSocketId] = {};
    return sendersRef.current[peerSocketId];
  }

  function getStreamToSend() {
    if (!localStreamRef.current) return null;
    return localStreamRef.current._processedStream || localStreamRef.current;
  }

  function emitLocalMediaState(patch) {
    const next = { ...localMediaStateRef.current, ...patch };
    localMediaStateRef.current = next;
    setLocalMediaState(next);
    if (onLocalMediaStateChangeRef.current) onLocalMediaStateChangeRef.current(next);
    if (socket && channelRef.current?.id && isJoinedRef.current) {
      socket.emit('voice:media-state:set', {
        channelId: channelRef.current.id,
        cameraOn: next.cameraOn,
        screenOn: next.screenOn,
      });
    }
  }

  function storeTrackMeta(peerSocketId, meta) {
    if (!trackMetadataRef.current[peerSocketId]) trackMetadataRef.current[peerSocketId] = [];
    trackMetadataRef.current[peerSocketId].push({ ...meta, used: false });
  }

  function resolveTrackSource(peerSocketId, track, remoteStream) {
    const metas = trackMetadataRef.current[peerSocketId] || [];
    const exact = metas.find(meta => !meta.used && meta.trackId && meta.trackId === track.id);
    if (exact) {
      exact.used = true;
      return exact.source;
    }
    const byStream = metas.find(meta => !meta.used && meta.streamId && remoteStream?.id && meta.streamId === remoteStream.id);
    if (byStream) {
      byStream.used = true;
      return byStream.source;
    }
    const firstUnused = metas.find(meta => !meta.used);
    if (firstUnused) {
      firstUnused.used = true;
      return firstUnused.source;
    }
    return 'camera';
  }

  function applyRemotePeerSettings(peerSocketId, remoteGain = remoteGainNodesRef.current[peerSocketId]) {
    if (!peerSocketId || !remoteGain?.gainNode) return;

    const member = findMemberBySocket(voiceMembersRef.current, peerSocketId);
    if (member?.id) peerUserIdsRef.current[peerSocketId] = member.id;

    if (isDeafenedRef.current) {
      remoteGain.gainNode.gain.value = 0;
      return;
    }

    const peerUserId = member?.id || peerUserIdsRef.current[peerSocketId];
    if (!peerUserId) {
      remoteGain.gainNode.gain.value = 1;
      return;
    }

    const isMutedByUser = !!userMutesRef.current[peerUserId];
    const volume = userVolumesRef.current[peerUserId] !== undefined ? userVolumesRef.current[peerUserId] : 1;
    remoteGain.gainNode.gain.value = isMutedByUser ? 0 : volumeToGain(volume);
  }

  function applyLocalAudioSendState() {
    const shouldSendAudio = !currentMuteStateRef.current && !isDeafenedRef.current;
    const userId = localStorage.getItem('userId');

    const rawTrack = localStreamRef.current?.getAudioTracks?.()[0];
    if (rawTrack) rawTrack.enabled = shouldSendAudio;

    const processedTrack = localStreamRef.current?._processedStream?.getAudioTracks?.()[0];
    if (processedTrack) processedTrack.enabled = shouldSendAudio;

    Object.values(sendersRef.current).forEach((senders) => {
      if (senders?.audio?.track) senders.audio.track.enabled = shouldSendAudio;
    });

    const filter = userId ? audioFiltersRef.current[userId] : null;
    if (audioContextRef.current && filter?.muteGain) {
      try {
        const targetGain = shouldSendAudio ? 1 : 0;
        const currentTime = audioContextRef.current.currentTime;
        filter.muteGain.gain.cancelScheduledValues(currentTime);
        filter.muteGain.gain.setValueAtTime(targetGain, currentTime);
      } catch {}
    }
  }

  async function renegotiatePeer(peerSocketId, options = {}) {
    const pc = peersRef.current[peerSocketId];
    if (!pc || pc.signalingState === 'closed' || !socket) return;

    if (makingOfferRef.current[peerSocketId]) {
      pendingNegotiationRef.current[peerSocketId] = true;
      return;
    }

    if (pc.signalingState !== 'stable') {
      pendingNegotiationRef.current[peerSocketId] = true;
      return;
    }

    makingOfferRef.current[peerSocketId] = true;
    try {
      const offer = await pc.createOffer(options);
      await pc.setLocalDescription(offer);
      socket.emit('voice:offer', {
        target: peerSocketId,
        channelId: channelRef.current?.id,
        sdp: pc.localDescription,
      });
    } catch (err) {
      console.error('[Voice] Negotiation failed for', peerSocketId, err);
    } finally {
      makingOfferRef.current[peerSocketId] = false;
      if (pendingNegotiationRef.current[peerSocketId]) {
        pendingNegotiationRef.current[peerSocketId] = false;
        setTimeout(() => renegotiatePeer(peerSocketId), 0);
      }
    }
  }

  function addAudioTrackToPeer(peerSocketId, pc = peersRef.current[peerSocketId]) {
    if (!pc) return;
    const senders = getPeerSenders(peerSocketId);
    if (senders.audio) return;
    const stream = getStreamToSend();
    const track = stream?.getAudioTracks()[0];
    if (!stream || !track) return;
    senders.audio = pc.addTrack(track, stream);
  }

  function emitTrackMeta(peerSocketId, source, stream, track) {
    if (!socket || !channelRef.current?.id) return;
    socket.emit('voice:track-meta', {
      target: peerSocketId,
      channelId: channelRef.current.id,
      source,
      streamId: stream.id,
      trackId: track.id,
    });
  }

  async function addVideoTrackToPeer(peerSocketId, source, stream, shouldNegotiate = true) {
    const pc = peersRef.current[peerSocketId];
    if (!pc || !stream) return;
    const track = stream.getVideoTracks()[0];
    if (!track) return;

    const senders = getPeerSenders(peerSocketId);
    if (senders[source]) return;

    emitTrackMeta(peerSocketId, source, stream, track);
    senders[source] = pc.addTrack(track, stream);
    if (shouldNegotiate) await renegotiatePeer(peerSocketId);
  }

  async function removeVideoTrackFromPeer(peerSocketId, source, shouldNegotiate = true) {
    const pc = peersRef.current[peerSocketId];
    const senders = getPeerSenders(peerSocketId);
    const sender = senders[source];
    if (!pc || !sender) return;

    try { pc.removeTrack(sender); } catch {}
    delete senders[source];
    if (shouldNegotiate) await renegotiatePeer(peerSocketId);
  }

  function ensureLocalSenders(peerSocketId, pc = peersRef.current[peerSocketId]) {
    if (!pc) return;
    addAudioTrackToPeer(peerSocketId, pc);
    if (localCameraStreamRef.current) {
      addVideoTrackToPeer(peerSocketId, 'camera', localCameraStreamRef.current, false);
    }
    if (localScreenStreamRef.current && screenWatchersRef.current.has(peerSocketId)) {
      addVideoTrackToPeer(peerSocketId, 'screen', localScreenStreamRef.current, false);
    }
  }

  function clearRemoteVideoForSocket(peerSocketId) {
    const userId = peerUserIdsRef.current[peerSocketId];
    if (!userId) return;
    setRemoteVideoStreams(prev => {
      const next = { ...prev };
      delete next[userId];
      return next;
    });
  }

  function setRemoteVideoTrack(peerSocketId, source, track, remoteStream) {
    const member = findMemberBySocket(voiceMembersRef.current, peerSocketId);
    const userId = member?.id || peerUserIdsRef.current[peerSocketId];
    if (!userId) return;

    peerUserIdsRef.current[peerSocketId] = userId;
    const stream = remoteStream?.getTracks?.().includes(track)
      ? remoteStream
      : new MediaStream([track]);

    const publishTrack = () => {
      setRemoteVideoStreams(prev => ({
        ...prev,
        [userId]: {
          ...(prev[userId] || {}),
          [source]: stream,
        },
      }));
    };

    publishTrack();
    track.onunmute = publishTrack;

    track.onended = () => {
      setRemoteVideoStreams(prev => {
        const current = prev[userId] || {};
        if (current[source] !== stream) return prev;
        const updated = { ...current };
        delete updated[source];
        const next = { ...prev };
        if (Object.keys(updated).length) next[userId] = updated;
        else delete next[userId];
        return next;
      });
    };
  }

  function createPeerConnection(peerSocketId, peerUserId) {
    const existing = peersRef.current[peerSocketId];
    if (existing && existing.signalingState !== 'closed') return existing;

    if (peerUserId) peerUserIdsRef.current[peerSocketId] = peerUserId;
    const pc = new RTCPeerConnection(ICE_SERVERS);
    peersRef.current[peerSocketId] = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('voice:ice-candidate', {
          target: peerSocketId,
          channelId: channelRef.current?.id,
          candidate: event.candidate,
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        renegotiatePeer(peerSocketId, { iceRestart: true });
      }
    };

    pc.ontrack = (event) => {
      const remoteStream = event.streams?.[0] || new MediaStream([event.track]);
      if (event.track.kind === 'video') {
        const source = resolveTrackSource(peerSocketId, event.track, remoteStream);
        setRemoteVideoTrack(peerSocketId, source, event.track, remoteStream);
        return;
      }

      if (event.track.kind !== 'audio') return;

      let remoteAudioCtx = remoteAudioContextRef.current;
      if (!remoteAudioCtx || remoteAudioCtx.state === 'closed') {
        remoteAudioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
        remoteAudioContextRef.current = remoteAudioCtx;
      }
      if (remoteAudioCtx.state === 'suspended') remoteAudioCtx.resume().catch(() => {});

      const audioStream = new MediaStream([event.track]);
      const source = remoteAudioCtx.createMediaStreamSource(audioStream);
      const vs = loadVoiceSettings();
      const { gainNode, compressor, makeupGain } = createRemoteAudioChain(remoteAudioCtx, source, vs.outputVolume);
      const remoteGain = { gainNode, compressor, makeupGain };
      remoteGainNodesRef.current[peerSocketId] = remoteGain;
      applyRemotePeerSettings(peerSocketId, remoteGain);

      let audioEl = audioElementsRef.current[peerSocketId];
      if (!audioEl) {
        audioEl = document.createElement('audio');
        audioEl.autoplay = true;
        audioEl.controls = false;
        audioEl.style.display = 'none';
        audioEl.setAttribute('playsinline', 'true');
        document.body.appendChild(audioEl);
        audioElementsRef.current[peerSocketId] = audioEl;
      }
      audioEl.srcObject = audioStream;
      audioEl.muted = true;
      audioEl.play().catch(() => {});
    };

    ensureLocalSenders(peerSocketId, pc);
    return pc;
  }

  useEffect(() => {
    voiceMembers.forEach(member => {
      if (member.socketId) {
        peerUserIdsRef.current[member.socketId] = member.id;
        applyRemotePeerSettings(member.socketId);
      }
    });
  }, [userVolumes, userMutes, voiceMembers, isDeafened]);

  useEffect(() => {
    if (socket && channel) {
      onSelectUserForControl(null);
      joinVoice();
    }
    return () => {
      onSelectUserForControl(null);
      cleanupVoiceResources();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, channel?.id]);

  useEffect(() => {
    const applyMuteState = () => {
      if (audioContextRef.current?.state === 'suspended') audioContextRef.current.resume().catch(() => {});
      applyLocalAudioSendState();
    };

    applyMuteState();
    const muteCheckInterval = setInterval(applyMuteState, 200);
    return () => clearInterval(muteCheckInterval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMuted]);

  useEffect(() => {
    applyLocalAudioSendState();
    if (isDeafened) {
      Object.values(remoteGainNodesRef.current).forEach(rg => {
        if (rg?.gainNode) rg.gainNode.gain.value = 0;
      });
    } else {
      voiceMembers.forEach(member => {
        if (member.socketId) {
          peerUserIdsRef.current[member.socketId] = member.id;
          applyRemotePeerSettings(member.socketId);
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDeafened, voiceMembers, userMutes, userVolumes]);

  useEffect(() => {
    const activeScreenUsers = Object.entries(mediaStates)
      .filter(([, state]) => state.screenOn)
      .map(([userId]) => userId);

    if (selectedScreenUserId && !activeScreenUsers.includes(selectedScreenUserId)) {
      selectScreenUser(null);
      return;
    }

    if (!selectedScreenUserId && activeScreenUsers.length === 1) {
      selectScreenUser(activeScreenUsers[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaStates, selectedScreenUserId]);

  useImperativeHandle(ref, () => ({
    toggleCamera: () => {
      if (localMediaStateRef.current.cameraOn) stopCamera();
      else startCamera();
    },
    toggleScreenShare: () => {
      if (localMediaStateRef.current.screenOn) stopScreenShare();
      else setShowScreenPicker(true);
    },
    cameraOn: localMediaState.cameraOn,
    screenOn: localMediaState.screenOn,
  }));

  function cleanupPeer(peerSocketId) {
    const pc = peersRef.current[peerSocketId];
    if (pc) {
      try { pc.close(); } catch {}
      delete peersRef.current[peerSocketId];
    }

    const remoteGain = remoteGainNodesRef.current[peerSocketId];
    if (remoteGain) {
      try { remoteGain.gainNode?.disconnect(); } catch {}
      delete remoteGainNodesRef.current[peerSocketId];
    }

    const audioEl = audioElementsRef.current[peerSocketId];
    if (audioEl) {
      try { audioEl.pause(); } catch {}
      if (audioEl.srcObject) audioEl.srcObject = null;
      try { audioEl.remove(); } catch {}
      delete audioElementsRef.current[peerSocketId];
    }

    clearRemoteVideoForSocket(peerSocketId);
    delete sendersRef.current[peerSocketId];
    delete trackMetadataRef.current[peerSocketId];
    delete makingOfferRef.current[peerSocketId];
    delete pendingNegotiationRef.current[peerSocketId];
    delete peerUserIdsRef.current[peerSocketId];
    screenWatchersRef.current.delete(peerSocketId);
  }

  function stopLocalVideoStreams() {
    if (localCameraStreamRef.current) {
      localCameraStreamRef.current.getTracks().forEach(track => {
        track.onended = null;
        track.stop();
      });
      localCameraStreamRef.current = null;
    }
    if (localScreenStreamRef.current) {
      localScreenStreamRef.current.getTracks().forEach(track => {
        track.onended = null;
        track.stop();
      });
      localScreenStreamRef.current = null;
    }
    setLocalVideoStreams({ camera: null, screen: null });
  }

  function cleanupSharedAudioResources() {
    Object.values(remoteGainNodesRef.current).forEach(rg => {
      try { rg.gainNode?.disconnect(); } catch {}
    });
    remoteGainNodesRef.current = {};

    if (remoteAudioContextRef.current && remoteAudioContextRef.current.state !== 'closed') {
      try { remoteAudioContextRef.current.close(); } catch {}
    }
    remoteAudioContextRef.current = null;

    Object.values(audioElementsRef.current).forEach(a => {
      try { a.pause(); } catch {}
      if (a.srcObject) a.srcObject = null;
      try { a.remove(); } catch {}
    });
    audioElementsRef.current = {};
  }

  function cleanupLocalResources() {
    if (speakingDetectionRef.current) {
      clearInterval(speakingDetectionRef.current);
      speakingDetectionRef.current = null;
    }
    isJoinedRef.current = false;

    Object.keys(peersRef.current).forEach(cleanupPeer);
    peersRef.current = {};
    sendersRef.current = {};

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      if (localStreamRef.current._processedStream) {
        localStreamRef.current._processedStream.getTracks().forEach(t => t.stop());
      }
      localStreamRef.current = null;
    }

    stopLocalVideoStreams();

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      try { audioContextRef.current.close(); } catch {}
    }

    cleanupSharedAudioResources();

    Object.values(audioFiltersRef.current).forEach(f => {
      if (f.rnnoiseNode?._destroy) {
        try { f.rnnoiseNode._destroy(); } catch {}
      }
    });

    analyserRef.current = {};
    dataArrayRef.current = {};
    audioFiltersRef.current = {};
    remoteSpeakingRef.current = {};
    peerUserIdsRef.current = {};
    trackMetadataRef.current = {};
    screenWatchersRef.current = new Set();
    setRemoteVideoStreams({});
    setSpeakingMap({});
    if (onSpeakingChangeRef.current) onSpeakingChangeRef.current({});
  }

  function cleanupVoiceResources() {
    if (!socket) return;

    const userId = localStorage.getItem('userId');
    if (userId) {
      socket.emit('voice:speaking-status', {
        userId,
        isSpeaking: false,
        channelId: channelRef.current?.id,
      });
      socket.emit('voice:media-state:set', {
        channelId: channelRef.current?.id,
        cameraOn: false,
        screenOn: false,
      });
    }

    socket.emit('voice:screen-watch:set', {
      channelId: channelRef.current?.id,
      targetUserId: null,
    });
    socket.emit('voice:leave', { channelId: channelRef.current?.id });

    const h = handlersRef.current;
    if (h.handlePeerJoined) socket.off('voice:peer-joined', h.handlePeerJoined);
    if (h.handleOffer) socket.off('voice:offer', h.handleOffer);
    if (h.handleAnswer) socket.off('voice:answer', h.handleAnswer);
    if (h.handleRemoteIce) socket.off('voice:ice-candidate', h.handleRemoteIce);
    if (h.handlePeerLeft) socket.off('voice:peer-left', h.handlePeerLeft);
    if (h.handleRemoteSpeakingStatus) socket.off('voice:speaking-status', h.handleRemoteSpeakingStatus);
    if (h.handleCurrentPeers) socket.off('voice:current-peers', h.handleCurrentPeers);
    if (h.handleMediaStateUpdate) socket.off('voice:media-state:update', h.handleMediaStateUpdate);
    if (h.handleTrackMeta) socket.off('voice:track-meta', h.handleTrackMeta);
    if (h.handleViewerAdded) socket.off('voice:screen-watch:viewer-added', h.handleViewerAdded);
    if (h.handleViewerRemoved) socket.off('voice:screen-watch:viewer-removed', h.handleViewerRemoved);
    if (h.handleWatchCurrent) socket.off('voice:screen-watch:current', h.handleWatchCurrent);
    handlersRef.current = {};

    cleanupLocalResources();
    emitLocalMediaState({ cameraOn: false, screenOn: false });
    setMediaStates({});
    setSelectedScreenUserId(null);
    setFocusedTile(null);
    if (onMediaStatesChangeRef.current) onMediaStatesChangeRef.current(channelRef.current?.id, {});
  }

  async function joinVoice() {
    if (!socket || !channel) return;

    try {
      cleanupLocalResources();
      setMediaError('');

      const constraints = getUserMediaConstraints();
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;

      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
      const audioContext = audioContextRef.current;
      if (audioContext.state === 'suspended') await audioContext.resume().catch(() => {});

      remoteAudioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
      if (remoteAudioContextRef.current.state === 'suspended') await remoteAudioContextRef.current.resume().catch(() => {});

      const source = audioContext.createMediaStreamSource(stream);
      const filters = await createAudioFilters(audioContext, source);
      const destination = audioContext.createMediaStreamDestination();
      filters.gainNode.connect(destination);
      localStreamRef.current._processedStream = destination.stream;
      applyLocalAudioSendState();

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      filters.gainNode.connect(analyser);

      const userId = localStorage.getItem('userId');
      analyserRef.current[userId] = analyser;
      dataArrayRef.current[userId] = new Uint8Array(analyser.frequencyBinCount);
      audioFiltersRef.current[userId] = filters;

      if (filters.muteGain) {
        const gain = currentMuteStateRef.current ? 0 : 1;
        filters.muteGain.gain.setValueAtTime(gain, audioContext.currentTime);
      }

      const handlers = {
        handlePeerJoined: async ({ socketId, userId: peerUserId }) => {
          if (peerUserId) peerUserIdsRef.current[socketId] = peerUserId;
          await new Promise(resolve => setTimeout(resolve, 300));
          const pc = createPeerConnection(socketId, peerUserId);
          ensureLocalSenders(socketId, pc);
          await renegotiatePeer(socketId);
        },

        handleOffer: async ({ from, sdp }) => {
          const pc = createPeerConnection(from);
          const offerCollision = makingOfferRef.current[from] || pc.signalingState !== 'stable';
          const polite = socket.id > from;
          if (offerCollision && !polite) return;

          try {
            if (offerCollision) {
              try { await pc.setLocalDescription({ type: 'rollback' }); } catch {}
            }
            await pc.setRemoteDescription(new RTCSessionDescription(sdp));
            ensureLocalSenders(from, pc);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('voice:answer', {
              target: from,
              channelId: channelRef.current?.id,
              sdp: pc.localDescription,
            });
          } catch (err) {
            console.error('[Voice] Failed to handle offer from', from, err);
          }
        },

        handleAnswer: async ({ from, sdp }) => {
          const pc = peersRef.current[from];
          if (!pc || pc.signalingState !== 'have-local-offer') return;
          try { await pc.setRemoteDescription(new RTCSessionDescription(sdp)); } catch {}
        },

        handleRemoteIce: async ({ from, candidate }) => {
          const pc = peersRef.current[from];
          if (!pc || !candidate) return;
          try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
        },

        handlePeerLeft: ({ socketId }) => {
          cleanupPeer(socketId);
        },

        handleRemoteSpeakingStatus: ({ userId: remoteUserId, isSpeaking }) => {
          if (remoteUserId === userId) return;
          if (isSpeaking) remoteSpeakingRef.current[remoteUserId] = true;
          else delete remoteSpeakingRef.current[remoteUserId];
        },

        handleCurrentPeers: async (peers) => {
          for (const peer of peers) {
            if (peer.userId) peerUserIdsRef.current[peer.socketId] = peer.userId;
            const pc = createPeerConnection(peer.socketId, peer.userId);
            ensureLocalSenders(peer.socketId, pc);
            await renegotiatePeer(peer.socketId);
          }
        },

        handleMediaStateUpdate: ({ channelId, states }) => {
          if (String(channelId) !== String(channelRef.current?.id)) return;
          const next = normalizeMediaStates(states);
          const localUserId = localStorage.getItem('userId');
          if (localUserId) {
            next[localUserId] = {
              ...(next[localUserId] || { userId: localUserId, socketId: socket.id }),
              cameraOn: localMediaStateRef.current.cameraOn,
              screenOn: localMediaStateRef.current.screenOn,
            };
          }
          setMediaStates(next);
          if (onMediaStatesChangeRef.current) onMediaStatesChangeRef.current(channelId, next);
          setRemoteVideoStreams(prev => {
            const updated = { ...prev };
            Object.keys(updated).forEach(uid => {
              const state = next[uid];
              if (!state) {
                delete updated[uid];
                return;
              }
              updated[uid] = { ...updated[uid] };
              if (!state.cameraOn) delete updated[uid].camera;
              if (!state.screenOn) delete updated[uid].screen;
              if (!Object.keys(updated[uid]).length) delete updated[uid];
            });
            return updated;
          });
        },

        handleTrackMeta: ({ from, source, streamId, trackId }) => {
          storeTrackMeta(from, { source, streamId, trackId });
        },

        handleViewerAdded: async ({ viewerSocketId }) => {
          if (!viewerSocketId) return;
          screenWatchersRef.current.add(viewerSocketId);
          if (localScreenStreamRef.current) {
            createPeerConnection(viewerSocketId);
            await addVideoTrackToPeer(viewerSocketId, 'screen', localScreenStreamRef.current);
          }
        },

        handleViewerRemoved: async ({ viewerSocketId }) => {
          if (!viewerSocketId) return;
          screenWatchersRef.current.delete(viewerSocketId);
          await removeVideoTrackFromPeer(viewerSocketId, 'screen');
        },

        handleWatchCurrent: ({ channelId, targetUserId }) => {
          if (String(channelId) !== String(channelRef.current?.id)) return;
          setSelectedScreenUserId(targetUserId || null);
        },
      };

      handlersRef.current = handlers;

      socket.on('voice:peer-joined', handlers.handlePeerJoined);
      socket.on('voice:offer', handlers.handleOffer);
      socket.on('voice:answer', handlers.handleAnswer);
      socket.on('voice:ice-candidate', handlers.handleRemoteIce);
      socket.on('voice:peer-left', handlers.handlePeerLeft);
      socket.on('voice:speaking-status', handlers.handleRemoteSpeakingStatus);
      socket.on('voice:current-peers', handlers.handleCurrentPeers);
      socket.on('voice:media-state:update', handlers.handleMediaStateUpdate);
      socket.on('voice:track-meta', handlers.handleTrackMeta);
      socket.on('voice:screen-watch:viewer-added', handlers.handleViewerAdded);
      socket.on('voice:screen-watch:viewer-removed', handlers.handleViewerRemoved);
      socket.on('voice:screen-watch:current', handlers.handleWatchCurrent);

      socket.emit('voice:join', {
        channelId: channel.id,
        userId,
        isMuted: currentMuteStateRef.current,
        isDeafened: isDeafenedRef.current,
      });
      isJoinedRef.current = true;
      emitLocalMediaState({ cameraOn: false, screenOn: false });
      startSpeakingDetection(userId);
    } catch (err) {
      console.error('[Voice] Failed to join:', err);
      setMediaError(`Failed to join voice: ${err.message}`);
    }
  }

  function startSpeakingDetection(userId) {
    let previousSpeakingState = false;
    if (speakingDetectionRef.current) clearInterval(speakingDetectionRef.current);

    const detectSpeaking = () => {
      if (!isJoinedRef.current) {
        clearInterval(speakingDetectionRef.current);
        speakingDetectionRef.current = null;
        return;
      }

      const newSpeakingMap = {};
      const localAnalyser = analyserRef.current[userId];
      const localDataArray = dataArrayRef.current[userId];
      if (localAnalyser && localDataArray) {
        localAnalyser.getByteFrequencyData(localDataArray);
        const average = localDataArray.reduce((a, b) => a + b) / localDataArray.length;
        const max = Math.max(...localDataArray);
        newSpeakingMap[userId] = !currentMuteStateRef.current && (max > 40 || average > 15);
      }

      const memberIds = new Set((voiceMembersRef.current || []).map(m => m.id));
      Object.entries(remoteSpeakingRef.current).forEach(([remoteUserId, isSpeaking]) => {
        if (isSpeaking && memberIds.has(remoteUserId)) newSpeakingMap[remoteUserId] = true;
      });

      const isCurrentlySpeaking = newSpeakingMap[userId] || false;
      if (isCurrentlySpeaking !== previousSpeakingState) {
        previousSpeakingState = isCurrentlySpeaking;
        socket.emit('voice:speaking-status', {
          userId,
          isSpeaking: isCurrentlySpeaking,
          channelId: channelRef.current?.id,
        });
      }

      if (onSpeakingChangeRef.current) onSpeakingChangeRef.current(newSpeakingMap);
      setSpeakingMap(newSpeakingMap);
    };

    speakingDetectionRef.current = setInterval(detectSpeaking, 50);
  }

  async function startCamera() {
    if (!isJoinedRef.current) return;
    setMediaError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia(getCameraConstraints());
      localCameraStreamRef.current = stream;
      setLocalVideoStreams(prev => ({ ...prev, camera: stream }));
      const track = stream.getVideoTracks()[0];
      if (track) {
        track.enabled = true;
        track.contentHint = 'motion';
        track.onended = () => stopCamera();
      }

      for (const peerSocketId of Object.keys(peersRef.current)) {
        await addVideoTrackToPeer(peerSocketId, 'camera', stream);
      }

      emitLocalMediaState({ cameraOn: true });
      setFocusedTile(prev => prev || { userId: currentUserId, source: 'camera' });
    } catch (err) {
      console.error('[Voice] Failed to start camera:', err);
      setMediaError(`Camera failed: ${err.message}`);
    }
  }

  async function stopCamera() {
    const stream = localCameraStreamRef.current;
    if (!stream) {
      emitLocalMediaState({ cameraOn: false });
      return;
    }

    for (const peerSocketId of Object.keys(peersRef.current)) {
      await removeVideoTrackFromPeer(peerSocketId, 'camera');
    }

    stream.getTracks().forEach(track => {
      track.onended = null;
      track.stop();
    });
    localCameraStreamRef.current = null;
    setLocalVideoStreams(prev => ({ ...prev, camera: null }));
    emitLocalMediaState({ cameraOn: false });
  }

  async function startScreenShare(source) {
    if (!isJoinedRef.current) return;
    setShowScreenPicker(false);
    setMediaError('');

    try {
      if (source?.id && window.electron?.setScreenShareSource) {
        await window.electron.setScreenShareSource(source.id);
      }

      const displayConstraints = window.electron ? getScreenConstraints() : { video: true, audio: false };
      const stream = await navigator.mediaDevices.getDisplayMedia(displayConstraints);
      if (window.electron?.clearScreenShareSource) window.electron.clearScreenShareSource();

      localScreenStreamRef.current = stream;
      setLocalVideoStreams(prev => ({ ...prev, screen: stream }));
      const track = stream.getVideoTracks()[0];
      if (track) {
        track.enabled = true;
        track.contentHint = 'detail';
        if (!window.electron) {
          const screenConstraints = getScreenConstraints();
          track.applyConstraints(screenConstraints.video).catch((err) => {
            console.warn('[Voice] Browser screen constraints were ignored:', err);
          });
        }
        track.onended = () => stopScreenShare();
      }

      for (const peerSocketId of screenWatchersRef.current) {
        await addVideoTrackToPeer(peerSocketId, 'screen', stream);
      }

      emitLocalMediaState({ screenOn: true });
      setSelectedScreenUserId(currentUserId);
      setFocusedTile({ userId: currentUserId, source: 'screen' });
    } catch (err) {
      if (window.electron?.clearScreenShareSource) window.electron.clearScreenShareSource();
      console.error('[Voice] Failed to start screen share:', err);
      if (err.name !== 'NotAllowedError') setMediaError(`Screen share failed: ${err.message}`);
    }
  }

  async function stopScreenShare() {
    const stream = localScreenStreamRef.current;
    if (!stream) {
      emitLocalMediaState({ screenOn: false });
      return;
    }

    for (const peerSocketId of Object.keys(peersRef.current)) {
      await removeVideoTrackFromPeer(peerSocketId, 'screen');
    }

    stream.getTracks().forEach(track => {
      track.onended = null;
      track.stop();
    });
    localScreenStreamRef.current = null;
    screenWatchersRef.current = new Set();
    setLocalVideoStreams(prev => ({ ...prev, screen: null }));
    emitLocalMediaState({ screenOn: false });
    if (selectedScreenUserId === currentUserId) setSelectedScreenUserId(null);
  }

  function selectScreenUser(userId) {
    setSelectedScreenUserId(userId || null);
    if (!socket || !channelRef.current?.id) return;
    socket.emit('voice:screen-watch:set', {
      channelId: channelRef.current.id,
      targetUserId: userId && userId !== currentUserId ? userId : null,
    });
  }

  const participants = useMemo(() => {
    const membersById = new Map((voiceMembers || []).map(member => [member.id, member]));
    if (currentUserId && !membersById.has(currentUserId)) {
      membersById.set(currentUserId, {
        id: currentUserId,
        displayName: localStorage.getItem('drt_displayName') || 'You',
        username: localStorage.getItem('username') || 'you',
      });
    }

    Object.keys(mediaStates).forEach(userId => {
      if (!membersById.has(userId)) membersById.set(userId, { id: userId, displayName: userId });
    });

    return Array.from(membersById.values()).map(member => {
      const isSelf = member.id === currentUserId;
      const state = isSelf
        ? { ...(mediaStates[member.id] || {}), ...localMediaState }
        : mediaStates[member.id] || member;
      const remoteStreams = remoteVideoStreams[member.id] || {};
      return {
        ...member,
        isSelf,
        cameraOn: !!state.cameraOn,
        screenOn: !!state.screenOn,
        cameraStream: isSelf ? localVideoStreams.camera : remoteStreams.camera,
        screenStream: isSelf ? localVideoStreams.screen : remoteStreams.screen,
        selectedScreenUserId,
        mirrorSelfView: videoSettings.mirrorSelfView,
        isSpeaking: !!speakingMap[member.id],
        isMuted: !!member.isMuted,
        isDeafened: !!member.isDeafened,
      };
    });
  }, [
    voiceMembers,
    currentUserId,
    mediaStates,
    localMediaState,
    remoteVideoStreams,
    localVideoStreams,
    selectedScreenUserId,
    videoSettings.mirrorSelfView,
    speakingMap,
  ]);

  return (
    <>
      {showCallStage && (
        <CallStage
          channel={channel}
          participants={participants}
          focusedTile={focusedTile}
          onFocusTile={setFocusedTile}
          onSelectScreen={selectScreenUser}
          onMinimize={onMinimizeCall}
          onToggleCamera={() => (localMediaState.cameraOn ? stopCamera() : startCamera())}
          onToggleScreen={() => (localMediaState.screenOn ? stopScreenShare() : setShowScreenPicker(true))}
          onToggleMute={onToggleMuteSelf}
          onToggleDeafen={onToggleDeafenSelf}
          onLeave={onLeave}
          isMuted={isMuted}
          isDeafened={isDeafened}
          cameraOn={localMediaState.cameraOn}
          screenOn={localMediaState.screenOn}
          mediaError={mediaError}
        />
      )}

      {showFloatingCall && (
        <FloatingCallWindow
          participants={participants}
          focusedTile={focusedTile}
          onRestore={(tile) => {
            if (tile) setFocusedTile(tile);
            if (onRestoreCall) onRestoreCall();
          }}
          onSelectScreen={selectScreenUser}
        />
      )}

      <ScreenSharePicker
        isOpen={showScreenPicker}
        onSelect={startScreenShare}
        onCancel={() => {
          setShowScreenPicker(false);
          if (window.electron?.clearScreenShareSource) window.electron.clearScreenShareSource();
        }}
      />
    </>
  );
});

export default VoiceArea;
