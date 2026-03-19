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
 * volumeToGain — convert a linear slider value (0–2) into an
 * exponential gain value so that 200 % actually *sounds* twice as
 * loud.  Uses a power-curve: gain = v² — this maps:
 *   0 %  → 0.00   (silence)
 *  50 %  → 0.25
 * 100 %  → 1.00   (unity)
 * 150 %  → 2.25
 * 200 %  → 4.00   (+12 dB — perceptually ~2× louder)
 * ──────────────────────────────────────────────────────────────────── */
export function volumeToGain(sliderValue) {
  const v = Math.max(0, sliderValue);
  return v * v;
}

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
  highPassFilter.frequency.value = 80;
  highPassFilter.Q.value = 0.7;

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
  compressor.threshold.value = -24;
  compressor.knee.value = 12;
  compressor.ratio.value = 4;
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
      sampleRate: { ideal: 48000 },
      channelCount: { ideal: 1 },
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
    gainNode.gain.value = volumeToGain(vs.outputVolume);
  }
}

/* ────────────────────────────────────────────────────────────────────
 * createRemoteAudioChain — build a gain + compressor/limiter chain
 * for remote peer playback.  The compressor prevents clipping when
 * the user boosts another user's volume above 100 %.
 *
 * Chain: source → gainNode → compressor → destination
 * ──────────────────────────────────────────────────────────────────── */
export function createRemoteAudioChain(audioContext, sourceNode, initialGain = 1) {
  const gainNode = audioContext.createGain();
  gainNode.gain.value = volumeToGain(initialGain);

  // Gentle limiter to tame peaks when volume is boosted
  const compressor = audioContext.createDynamicsCompressor();
  compressor.threshold.value = -6;   // only kick in near clipping
  compressor.knee.value = 6;
  compressor.ratio.value = 12;       // aggressive limiting above threshold
  compressor.attack.value = 0.002;
  compressor.release.value = 0.1;

  // Make-up gain so limited audio doesn't sound quieter.
  // Electron's Chromium audio subsystem on Windows tends to output lower
  // levels than a regular browser tab, so we apply a larger boost there.
  const makeupGain = audioContext.createGain();
  makeupGain.gain.value = IS_ELECTRON ? 1.9 : 1.4;

  sourceNode.connect(gainNode);
  gainNode.connect(compressor);
  compressor.connect(makeupGain);
  makeupGain.connect(audioContext.destination);

  return { gainNode, compressor, makeupGain };
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
            rg.gainNode.gain.value = volumeToGain(vs.outputVolume);
          } catch {}
        }
      });
    }

    console.log('[AudioEngine] Pipeline settings updated live');
  });
}
