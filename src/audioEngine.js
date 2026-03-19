/**
 * audioEngine.js — Centralised audio pipeline that reads from voiceSettings
 * and exposes helpers consumed by VoiceArea.js.
 *
 * Responsibilities
 * ────────────────
 *  • getUserMedia with the persisted input device + WebRTC constraints
 *  • Build the Web Audio filter chain (noise gate, compressor, gain) using
 *    the persisted settings values
 *  • Route remote playback through gain nodes whose volume is driven by
 *    outputVolume from voiceSettings
 *  • Re-apply settings at runtime when the user tweaks a slider / toggle
 *    (via the onVoiceSettingsChange listener)
 *  • Switch input/output devices on-the-fly
 */

import { loadVoiceSettings, onVoiceSettingsChange } from './voiceSettings';

// Detect Electron
const IS_ELECTRON = !!(window.electron);

/* ────────────────────────────────────────────────────────────────────
 * createAudioFilters — lifted from VoiceArea.js but now parameterised
 * by the persisted voice settings.
 * ──────────────────────────────────────────────────────────────────── */
export function createAudioFilters(audioContext, sourceNode, opts = {}) {
  const vs = { ...loadVoiceSettings(), ...opts };

  // ── Mute control ──────────────────────────────────────────────────
  const muteGain = audioContext.createGain();
  muteGain.gain.value = 1;

  // ── High-pass (remove low rumble) ─────────────────────────────────
  const highPassFilter = audioContext.createBiquadFilter();
  highPassFilter.type = 'highpass';
  highPassFilter.frequency.value = 250;
  highPassFilter.Q.value = 0.5;

  // ── Notch (desk-tap removal) ──────────────────────────────────────
  const notchFilter = audioContext.createBiquadFilter();
  notchFilter.type = 'notch';
  notchFilter.frequency.value = 400;
  notchFilter.Q.value = 2;

  // ── Noise gate ────────────────────────────────────────────────────
  const scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
  let gateThreshold = vs.noiseGateThreshold;
  const gateAttack = 0.005;
  const gateRelease = 0.1;
  let gateEnvelope = 0;

  scriptProcessor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    const output = event.outputBuffer.getChannelData(0);

    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    const rms = Math.sqrt(sum / input.length);
    const db = 20 * Math.log10(Math.max(rms, 0.00001));

    const targetGain = db > gateThreshold ? 1 : 0;
    const rate = targetGain > gateEnvelope ? gateAttack : gateRelease;
    gateEnvelope += (targetGain - gateEnvelope) * rate;

    for (let i = 0; i < input.length; i++) output[i] = input[i] * gateEnvelope;
  };

  // Allow live updates to threshold
  scriptProcessor._setThreshold = (val) => { gateThreshold = val; };

  // ── Compressor ────────────────────────────────────────────────────
  const compressor = audioContext.createDynamicsCompressor();
  compressor.threshold.value = -30;
  compressor.knee.value = 10;
  compressor.ratio.value = 6;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.15;

  // ── Final gain (software gain * inputVolume) ──────────────────────
  const gainNode = audioContext.createGain();
  const baseGain = IS_ELECTRON ? 2.8 : 1.5;
  gainNode.gain.value = baseGain * vs.inputVolume * (vs.inputGain / 1.5);

  // ── Connect chain ─────────────────────────────────────────────────
  sourceNode.connect(muteGain);
  muteGain.connect(highPassFilter);

  if (vs.noiseSuppression) {
    highPassFilter.connect(notchFilter);
    notchFilter.connect(scriptProcessor);
    scriptProcessor.connect(compressor);
  } else {
    // Bypass notch + noise gate
    highPassFilter.connect(compressor);
  }
  compressor.connect(gainNode);

  return { muteGain, highPassFilter, notchFilter, scriptProcessor, compressor, gainNode };
}

/* ────────────────────────────────────────────────────────────────────
 * getConstraints — build getUserMedia constraints from settings
 * ──────────────────────────────────────────────────────────────────── */
export function getUserMediaConstraints(overrides = {}) {
  const vs = loadVoiceSettings();
  return {
    audio: {
      deviceId: vs.inputDeviceId !== 'default' ? { exact: vs.inputDeviceId } : undefined,
      echoCancellation: vs.echoCancellation,
      noiseSuppression: vs.noiseSuppression,
      autoGainControl: vs.autoGainControl,
      sampleRate: { ideal: 16000 },
      ...overrides,
    },
  };
}

/* ────────────────────────────────────────────────────────────────────
 * applyOutputDevice — set the sink on an HTMLAudioElement (best-effort)
 * ──────────────────────────────────────────────────────────────────── */
export async function applyOutputDevice(audioElement) {
  const vs = loadVoiceSettings();
  if (!audioElement || !audioElement.setSinkId) return;
  if (vs.outputDeviceId === 'default') return;
  try {
    await audioElement.setSinkId(vs.outputDeviceId);
  } catch (e) {
    console.warn('[AudioEngine] setSinkId failed — using system default', e);
  }
}

/* ────────────────────────────────────────────────────────────────────
 * applyRemoteGain — set gain on a remote peer's playback to match
 * the global outputVolume setting (clamped to 0–2).
 * ──────────────────────────────────────────────────────────────────── */
export function applyRemoteGain(gainNode) {
  const vs = loadVoiceSettings();
  if (gainNode) {
    gainNode.gain.value = Math.max(0, Math.min(2, vs.outputVolume));
  }
}

/* ────────────────────────────────────────────────────────────────────
 * liveUpdate — call from VoiceArea to subscribe to settings changes
 * and patch the running audio pipeline in real-time.
 *
 * Returns an unsubscribe function.
 * ──────────────────────────────────────────────────────────────────── */
export function subscribeToPipelineUpdates({ filtersRef, remoteGainNodesRef, localStreamRef, audioContextRef }) {
  return onVoiceSettingsChange((vs) => {
    const baseGain = IS_ELECTRON ? 2.8 : 1.5;

    // Update local capture gain
    const userId = localStorage.getItem('userId');
    const filters = filtersRef?.current?.[userId];
    if (filters) {
      if (filters.gainNode) {
        try {
          filters.gainNode.gain.value = baseGain * vs.inputVolume * (vs.inputGain / 1.5);
        } catch {}
      }
      if (filters.scriptProcessor && filters.scriptProcessor._setThreshold) {
        filters.scriptProcessor._setThreshold(vs.noiseGateThreshold);
      }
    }

    // Update remote playback gain (outputVolume)
    if (remoteGainNodesRef?.current) {
      Object.values(remoteGainNodesRef.current).forEach((rg) => {
        if (rg && rg.gainNode) {
          try {
            rg.gainNode.gain.value = Math.max(0, Math.min(2, vs.outputVolume));
          } catch {}
        }
      });
    }

    console.log('[AudioEngine] Pipeline settings updated live');
  });
}
