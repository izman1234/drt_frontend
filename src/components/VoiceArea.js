import React, { useEffect, useRef, useCallback, useState } from 'react';
import {
  createAudioFilters,
  getUserMediaConstraints,
  subscribeToPipelineUpdates,
} from '../audioEngine';
import { loadVoiceSettings } from '../voiceSettings';
import './VoiceArea.css';

const ICE_SERVERS = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

function VoiceArea({ socket, channel, onLeave, onSpeakingChange, isMuted, isDeafened, voiceMembers = [], currentUserId, selectedUserForControl, onSelectUserForControl, userVolumes, userMutes, onVolumeChange, onToggleMute }) {
  const localStreamRef = useRef(null);
  const peersRef = useRef({}); // { socketId: RTCPeerConnection }
  const audioElementsRef = useRef({});
  const analyserRef = useRef({});
  const dataArrayRef = useRef({});
  const remoteSpeakingRef = useRef({}); // { userId: isSpeaking }
  const audioContextRef = useRef(null);
  const audioFiltersRef = useRef({}); // { userId: { highPassFilter, compressor, gainNode, muteGain } }
  const remoteGainNodesRef = useRef({}); // { socketId: { gainNode, audioContext } } for per-peer volume control
  const isMutedRef = useRef(isMuted);
  const currentMuteStateRef = useRef(isMuted);
  const speakingDetectionRef = useRef(null); // ID for cancelling setInterval
  const voiceMembersRef = useRef(voiceMembers); // Keep fresh reference for speaking detection
  const isJoinedRef = useRef(false); // Track if we're actively in a voice channel
  const handlersRef = useRef({}); // Store registered socket handler references for cleanup
  const onSpeakingChangeRef = useRef(onSpeakingChange);
  const channelRef = useRef(channel);
  
  // Volume and mute controls
  const [, setSpeakingMap] = useState({});

  // Keep refs in sync with props
  useEffect(() => {
    isMutedRef.current = isMuted;
    currentMuteStateRef.current = isMuted;
  }, [isMuted]);
  
  useEffect(() => {
    voiceMembersRef.current = voiceMembers;
  }, [voiceMembers]);

  useEffect(() => {
    onSpeakingChangeRef.current = onSpeakingChange;
  }, [onSpeakingChange]);

  useEffect(() => {
    channelRef.current = channel;
  }, [channel]);

  // Subscribe to live voice settings changes and patch the audio pipeline in real time
  useEffect(() => {
    const unsub = subscribeToPipelineUpdates({
      filtersRef: audioFiltersRef,
      remoteGainNodesRef,
      localStreamRef,
      audioContextRef,
    });
    return unsub;
  }, []);

  const createPeerConnection = useCallback((peerSocketId) => {
    const pc = new RTCPeerConnection(ICE_SERVERS);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('voice:ice-candidate', { target: peerSocketId, candidate: event.candidate });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('[PC] Connection with', peerSocketId, ':', pc.connectionState);
      if (pc.connectionState === 'failed') {
        console.warn('[PC] Connection failed with', peerSocketId, '— attempting ICE restart');
        // Attempt ICE restart to recover the connection
        try {
          pc.restartIce();
          pc.createOffer({ iceRestart: true }).then(offer => {
            return pc.setLocalDescription(offer).then(() => {
              socket.emit('voice:offer', { target: peerSocketId, sdp: offer });
            });
          }).catch(err => {
            console.error('[PC] ICE restart failed for', peerSocketId, err);
          });
        } catch (err) {
          console.error('[PC] ICE restart error for', peerSocketId, err);
        }
      } else if (pc.connectionState === 'disconnected') {
        console.warn('[PC] Connection disconnected with', peerSocketId);
      }
    };

    pc.ontrack = (event) => {
      const remoteStream = event.streams && event.streams[0];
      if (!remoteStream) return;

      // Play remote audio via Web Audio API for volume amplification (0-200%)
      // Route: MediaStream → source → gainNode → speakers (audioContext.destination)
      const remoteAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (remoteAudioCtx.state === 'suspended') {
        remoteAudioCtx.resume().catch(() => {});
      }
      const source = remoteAudioCtx.createMediaStreamSource(remoteStream);
      const gainNode = remoteAudioCtx.createGain();
      // Apply persisted output volume from voice settings
      const vs = loadVoiceSettings();
      gainNode.gain.value = Math.max(0, Math.min(2, vs.outputVolume));
      source.connect(gainNode);
      gainNode.connect(remoteAudioCtx.destination);
      remoteGainNodesRef.current[peerSocketId] = { gainNode, audioContext: remoteAudioCtx };

      // Keep a muted audio element attached to the stream for lifecycle management
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
      audioEl.srcObject = remoteStream;
      audioEl.muted = true; // Audio plays via Web Audio API, not the element
      audioEl.play().catch(() => {});
    };

    return pc;
  }, [socket]);

  // Apply per-user volume/mute settings via gain nodes
  useEffect(() => {
    if (isDeafened) return; // Don't override deafen with per-user settings
    voiceMembers.forEach(member => {
      const peerSocketId = member.socketId;
      const remoteGain = remoteGainNodesRef.current[peerSocketId];
      if (remoteGain && remoteGain.gainNode) {
        const isMutedByUser = !!(userMutes && userMutes[member.id]);
        const volume = (userVolumes && userVolumes[member.id] !== undefined) ? userVolumes[member.id] : 1;
        remoteGain.gainNode.gain.value = isMutedByUser ? 0 : volume;
      }
    });
  }, [userVolumes, userMutes, voiceMembers, isDeafened]);

  useEffect(() => {
    if (socket && channel) {
      // Reset selected user when joining a new voice channel
      onSelectUserForControl(null);
      joinVoice();
    }
    return () => {
      // Clear selection when leaving voice channel
      onSelectUserForControl(null);
      cleanupVoiceResources();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, channel?.id]);

  // Handle muting/unmuting the microphone via Web Audio API gain
  useEffect(() => {
    const userId = localStorage.getItem('userId');
    
    const applyMuteState = () => {
      if (!audioContextRef.current || !audioFiltersRef.current[userId]) return;
      const filter = audioFiltersRef.current[userId];
      if (!filter.muteGain) return;
      
      try {
        if (audioContextRef.current.state === 'suspended') {
          audioContextRef.current.resume().catch(() => {});
        }
        const targetGain = currentMuteStateRef.current ? 0 : 1;
        const currentTime = audioContextRef.current.currentTime;
        filter.muteGain.gain.cancelScheduledValues(currentTime);
        filter.muteGain.gain.setValueAtTime(targetGain, currentTime);
      } catch (err) {
        // Audio context may have been closed
      }
    };
    
    applyMuteState();
    const muteCheckInterval = setInterval(applyMuteState, 200);
    return () => clearInterval(muteCheckInterval);
  }, [isMuted]);

  // Handle deafening (muting all remote audio AND local microphone)
  useEffect(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = !isDeafened;
      });
    }
    if (isDeafened) {
      // Silence all remote audio via gain nodes when deafened
      Object.values(remoteGainNodesRef.current).forEach(rg => {
        if (rg && rg.gainNode) rg.gainNode.gain.value = 0;
      });
    } else {
      // When undeafening, restore per-user mute and volume settings via gain nodes
      voiceMembers.forEach(member => {
        const peerSocketId = member.socketId;
        const remoteGain = remoteGainNodesRef.current[peerSocketId];
        if (remoteGain && remoteGain.gainNode) {
          const isMutedByUser = !!(userMutes && userMutes[member.id]);
          const volume = (userVolumes && userVolumes[member.id] !== undefined) ? userVolumes[member.id] : 1;
          remoteGain.gainNode.gain.value = isMutedByUser ? 0 : volume;
        }
      });
    }
  }, [isDeafened, voiceMembers, userMutes, userVolumes]);

  

  const getStreamToSend = () => {
    if (!localStreamRef.current) return null;
    return localStreamRef.current._processedStream || localStreamRef.current;
  };

  const cleanupVoiceResources = () => {
    if (!socket) return;

    // Emit final "not speaking" so remote peers clear the green glow
    const userId = localStorage.getItem('userId');
    if (userId) {
      socket.emit('voice:speaking-status', {
        userId,
        isSpeaking: false,
        channelId: channelRef.current?.id
      });
    }

    isJoinedRef.current = false;

    // Cancel speaking detection loop
    if (speakingDetectionRef.current) {
      clearInterval(speakingDetectionRef.current);
      speakingDetectionRef.current = null;
    }

    socket.emit('voice:leave', { channelId: channelRef.current?.id });

    // Remove socket listeners using stored references
    const h = handlersRef.current;
    if (h.handlePeerJoined) socket.off('voice:peer-joined', h.handlePeerJoined);
    if (h.handleOffer) socket.off('voice:offer', h.handleOffer);
    if (h.handleAnswer) socket.off('voice:answer', h.handleAnswer);
    if (h.handleRemoteIce) socket.off('voice:ice-candidate', h.handleRemoteIce);
    if (h.handlePeerLeft) socket.off('voice:peer-left', h.handlePeerLeft);
    if (h.handleRemoteSpeakingStatus) socket.off('voice:speaking-status', h.handleRemoteSpeakingStatus);
    if (h.handleCurrentPeers) socket.off('voice:current-peers', h.handleCurrentPeers);
    handlersRef.current = {};

    // Close all peer connections
    Object.values(peersRef.current).forEach(pc => {
      try { pc.close(); } catch (e) {}
    });
    peersRef.current = {};

    // Stop local tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      if (localStreamRef.current._processedStream) {
        localStreamRef.current._processedStream.getTracks().forEach(t => t.stop());
      }
      localStreamRef.current = null;
    }

    // Close audio context
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      try { audioContextRef.current.close(); } catch (e) {}
    }

    // Close remote gain node audio contexts
    Object.values(remoteGainNodesRef.current).forEach(rg => {
      try { rg.audioContext.close(); } catch (e) {}
    });
    remoteGainNodesRef.current = {};

    // Remove audio elements
    Object.values(audioElementsRef.current).forEach(a => {
      try { a.pause(); } catch (e) {}
      if (a.srcObject) a.srcObject = null;
      try { a.remove(); } catch (e) {}
    });
    audioElementsRef.current = {};

    // Clear all refs
    analyserRef.current = {};
    dataArrayRef.current = {};
    audioFiltersRef.current = {};
    remoteSpeakingRef.current = {};
    setSpeakingMap({});
    if (onSpeakingChangeRef.current) {
      onSpeakingChangeRef.current({});
    }
  };

  // Light cleanup of local audio resources only (no socket events)
  const cleanupLocalResources = () => {
    // Cancel speaking detection
    if (speakingDetectionRef.current) {
      clearInterval(speakingDetectionRef.current);
      speakingDetectionRef.current = null;
    }
    isJoinedRef.current = false;

    // Close all peer connections
    Object.values(peersRef.current).forEach(pc => {
      try { pc.close(); } catch (e) {}
    });
    peersRef.current = {};

    // Stop local tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      if (localStreamRef.current._processedStream) {
        localStreamRef.current._processedStream.getTracks().forEach(t => t.stop());
      }
      localStreamRef.current = null;
    }

    // Close audio context
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      try { audioContextRef.current.close(); } catch (e) {}
    }

    // Close remote gain node audio contexts
    Object.values(remoteGainNodesRef.current).forEach(rg => {
      try { rg.audioContext.close(); } catch (e) {}
    });
    remoteGainNodesRef.current = {};

    // Remove audio elements
    Object.values(audioElementsRef.current).forEach(a => {
      try { a.pause(); } catch (e) {}
      if (a.srcObject) a.srcObject = null;
      try { a.remove(); } catch (e) {}
    });
    audioElementsRef.current = {};

    analyserRef.current = {};
    dataArrayRef.current = {};
    audioFiltersRef.current = {};
    remoteSpeakingRef.current = {};
    setSpeakingMap({});
    if (onSpeakingChangeRef.current) {
      onSpeakingChangeRef.current({});
    }
  };

  const joinVoice = async () => {
    if (!socket || !channel) return;

    try {
      // Clean up local audio resources (socket cleanup is handled by effect cleanup)
      cleanupLocalResources();

      // Request fresh microphone stream (using persisted voice settings)
      const constraints = getUserMediaConstraints();
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;

      // Create fresh audio context
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      const audioContext = audioContextRef.current;
      if (audioContext.state === 'suspended') {
        audioContext.resume().catch(() => {});
      }

      // Set up audio processing chain (reading from persisted voice settings)
      const source = audioContext.createMediaStreamSource(stream);
      const filters = createAudioFilters(audioContext, source);
      const destination = audioContext.createMediaStreamDestination();
      filters.gainNode.connect(destination);
      localStreamRef.current._processedStream = destination.stream;

      // Set up analyser for local speaking detection
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      filters.gainNode.connect(analyser);

      const userId = localStorage.getItem('userId');
      analyserRef.current[userId] = analyser;
      dataArrayRef.current[userId] = new Uint8Array(analyser.frequencyBinCount);
      audioFiltersRef.current[userId] = filters;

      // Initialize mute gain
      if (filters.muteGain) {
        const gain = currentMuteStateRef.current ? 0 : 1;
        filters.muteGain.gain.setValueAtTime(gain, audioContext.currentTime);
      }

      // Define all socket handlers inline, capturing fresh state via refs
      const handlers = {
        handlePeerJoined: async ({ socketId }) => {
          // Wait briefly so the joining peer can register listeners via handleCurrentPeers first
          await new Promise(resolve => setTimeout(resolve, 500));

          // If a PC already exists and is healthy, skip — handleCurrentPeers already connected
          const existingPc = peersRef.current[socketId];
          if (existingPc) {
            const state = existingPc.connectionState;
            if (state === 'connected' || state === 'connecting' || state === 'new') {
              return;
            }
            // Stale/failed PC — close it and retry below
            try { existingPc.close(); } catch (e) {}
            delete peersRef.current[socketId];
          }

          // Fallback: create an offer from the existing peer's side
          const pc = createPeerConnection(socketId);
          peersRef.current[socketId] = pc;
          const s = getStreamToSend();
          if (s) s.getAudioTracks().forEach(track => pc.addTrack(track, s));
          try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit('voice:offer', { target: socketId, sdp: offer });
          } catch (err) {
            console.error('[Voice] Fallback offer failed for peer', socketId, err);
          }
        },

        handleOffer: async ({ from, sdp }) => {
          const existingPc = peersRef.current[from];

          // Polite peer: if we have a pending outgoing offer (glare condition),
          // the peer with the higher socket ID yields and accepts the incoming offer
          if (existingPc && existingPc.signalingState === 'have-local-offer') {
            const weArePolite = socket.id > from;
            if (!weArePolite) {
              // We are impolite - ignore the incoming offer, keep our outgoing one
              return;
            }
            // We are polite - roll back our offer and accept theirs
          }

          // Close any existing PC and create fresh
          if (existingPc) {
            try { existingPc.close(); } catch(e) {}
            delete peersRef.current[from];
          }

          const pc = createPeerConnection(from);
          peersRef.current[from] = pc;
          const s = getStreamToSend();
          if (s) s.getAudioTracks().forEach(track => pc.addTrack(track, s));

          try {
            await pc.setRemoteDescription(new RTCSessionDescription(sdp));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('voice:answer', { target: from, sdp: answer });
          } catch (err) {
            console.error('[Voice] Failed to handle offer from', from, err);
            if (peersRef.current[from] === pc) {
              try { pc.close(); } catch(e) {}
              delete peersRef.current[from];
            }
          }
        },

        handleAnswer: async ({ from, sdp }) => {
          const pc = peersRef.current[from];
          if (!pc) return;
          // Only accept answer if we're actually waiting for one
          if (pc.signalingState !== 'have-local-offer') return;
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(sdp));
          } catch (err) {
            // Silently ignore - stale answer for a replaced/closed PC
          }
        },

        handleRemoteIce: async ({ from, candidate }) => {
          const pc = peersRef.current[from];
          if (!pc) return;
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (err) { /* ICE candidate may arrive before remote description */ }
        },

        handlePeerLeft: ({ socketId }) => {
          const pc = peersRef.current[socketId];
          if (pc) {
            try { pc.close(); } catch (e) {}
            delete peersRef.current[socketId];
          }
          const remoteGain = remoteGainNodesRef.current[socketId];
          if (remoteGain) {
            try { remoteGain.audioContext.close(); } catch (e) {}
            delete remoteGainNodesRef.current[socketId];
          }
          const audioEl = audioElementsRef.current[socketId];
          if (audioEl) {
            try { audioEl.pause(); } catch (e) {}
            if (audioEl.srcObject) audioEl.srcObject = null;
            try { audioEl.remove(); } catch (e) {}
            delete audioElementsRef.current[socketId];
          }
        },

        handleRemoteSpeakingStatus: ({ userId: remoteUserId, isSpeaking }) => {
          // Ignore our own speaking status echoed back from the server
          if (remoteUserId === userId) return;
          if (isSpeaking) {
            remoteSpeakingRef.current[remoteUserId] = true;
          } else {
            delete remoteSpeakingRef.current[remoteUserId];
          }
        },

        handleCurrentPeers: async (peers) => {
          for (const peer of peers) {
            if (peersRef.current[peer.socketId]) continue;
            await new Promise(resolve => setTimeout(resolve, 50));
            const pc = createPeerConnection(peer.socketId);
            peersRef.current[peer.socketId] = pc;
            const s = getStreamToSend();
            if (s) s.getAudioTracks().forEach(track => pc.addTrack(track, s));
            try {
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              socket.emit('voice:offer', { target: peer.socketId, sdp: offer });
            } catch (err) {
              console.error('[Voice] Failed to create offer for', peer.socketId, err);
            }
          }
        }
      };

      handlersRef.current = handlers;

      // Register listeners BEFORE emitting join to prevent race condition
      socket.on('voice:peer-joined', handlers.handlePeerJoined);
      socket.on('voice:offer', handlers.handleOffer);
      socket.on('voice:answer', handlers.handleAnswer);
      socket.on('voice:ice-candidate', handlers.handleRemoteIce);
      socket.on('voice:peer-left', handlers.handlePeerLeft);
      socket.on('voice:speaking-status', handlers.handleRemoteSpeakingStatus);
      socket.on('voice:current-peers', handlers.handleCurrentPeers);

      // Now emit join
      socket.emit('voice:join', { channelId: channel.id, userId });
      isJoinedRef.current = true;

      // Start speaking detection
      startSpeakingDetection(userId);
    } catch (err) {
      console.error('[Voice] Failed to join:', err);
    }
  };

  const startSpeakingDetection = (userId) => {
    let previousSpeakingState = false;

    // Cancel any existing loop
    if (speakingDetectionRef.current) {
      clearInterval(speakingDetectionRef.current);
      speakingDetectionRef.current = null;
    }

    const detectSpeaking = () => {
      // Self-terminate if no longer joined
      if (!isJoinedRef.current) {
        clearInterval(speakingDetectionRef.current);
        speakingDetectionRef.current = null;
        return;
      }

      const newSpeakingMap = {};

      // Check local audio level
      const localAnalyser = analyserRef.current[userId];
      const localDataArray = dataArrayRef.current[userId];
      if (localAnalyser && localDataArray) {
        localAnalyser.getByteFrequencyData(localDataArray);
        const average = localDataArray.reduce((a, b) => a + b) / localDataArray.length;
        const max = Math.max(...localDataArray);
        const hasSignal = max > 40 || average > 15;
        newSpeakingMap[userId] = !currentMuteStateRef.current && hasSignal;
      }

      // Use voiceMembersRef for fresh channel membership
      const memberIds = new Set((voiceMembersRef.current || []).map(m => m.id));

      // Include remote speaking statuses, filtered by current channel members
      Object.entries(remoteSpeakingRef.current).forEach(([remoteUserId, isSpeaking]) => {
        if (isSpeaking && memberIds.has(remoteUserId)) {
          newSpeakingMap[remoteUserId] = true;
        }
      });

      // Broadcast local speaking state changes
      const isCurrentlySpeaking = newSpeakingMap[userId] || false;
      if (isCurrentlySpeaking !== previousSpeakingState) {
        previousSpeakingState = isCurrentlySpeaking;
        if (socket) {
          socket.emit('voice:speaking-status', {
            userId,
            isSpeaking: isCurrentlySpeaking,
            channelId: channelRef.current?.id
          });
        }
      }

      // Notify parent via ref (always fresh)
      if (onSpeakingChangeRef.current) {
        onSpeakingChangeRef.current(newSpeakingMap);
      }
      setSpeakingMap(newSpeakingMap);
    };

    // Use setInterval instead of requestAnimationFrame so speaking detection
    // continues running when the browser tab / Electron window is minimized.
    // requestAnimationFrame is paused by browsers for hidden tabs.
    speakingDetectionRef.current = setInterval(detectSpeaking, 50);
  };

  return (
    <>
      <div style={{ display: 'none' }}>
        {/* Audio processing happens via Web Audio API, no visible UI here */}
      </div>
    </>
  );
}

export default VoiceArea;
