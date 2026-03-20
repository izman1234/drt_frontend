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

  // ── Noise gate with per-sample envelope smoothing ─────────────────
  // The gate uses a first-order IIR envelope follower computed per-
  // sample so the gain transitions are smooth, not blocky.
  //   Attack  ≈ 5 ms  → voice is heard almost instantly
  //   Release ≈ 200 ms → brief pauses don't chop audio
  const scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
  let gateThreshold = vs.noiseGateThreshold;
  let gateBypassed = !vs.noiseSuppression;   // pass-through when NS is off
  let gateEnvelope = 1;  // start OPEN so first speech isn't silent

  const ATTACK_TC  = 0.005;  // seconds — time constant for opening
  const RELEASE_TC = 0.200;  // seconds — time constant for closing

  scriptProcessor.onaudioprocess = (event) => {
    const input  = event.inputBuffer.getChannelData(0);
    const output = event.outputBuffer.getChannelData(0);

    // Fast pass-through when noise suppression is disabled
    if (gateBypassed) {
      for (let i = 0; i < input.length; i++) output[i] = input[i];
      return;
    }

    // Compute RMS level for the whole buffer
    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    const rms = Math.sqrt(sum / input.length);
    const db  = 20 * Math.log10(Math.max(rms, 0.00001));

    const targetGain = db > gateThreshold ? 1 : 0;

    // Per-sample smoothing coefficients derived from time constants
    const sr = event.inputBuffer.sampleRate || 48000;
    const attackCoeff  = 1 - Math.exp(-1 / (ATTACK_TC  * sr));
    const releaseCoeff = 1 - Math.exp(-1 / (RELEASE_TC * sr));

    for (let i = 0; i < input.length; i++) {
      const coeff = targetGain > gateEnvelope ? attackCoeff : releaseCoeff;
      gateEnvelope += (targetGain - gateEnvelope) * coeff;
      output[i] = input[i] * gateEnvelope;
    }
  };

  // Live-update helpers called from subscribeToPipelineUpdates
  scriptProcessor._setThreshold = (val) => { gateThreshold = val; };
  scriptProcessor._setBypass    = (bypass) => {
    gateBypassed = bypass;
    if (bypass) gateEnvelope = 1;  // reset to open on bypass change
  };

  // ── Compressor — gentler when AGC is active (they overlap) ────────
  const compressor = audioContext.createDynamicsCompressor();
  compressor.attack.value  = 0.003;
  compressor.release.value = 0.15;
  const applyCompressorMode = (agcOn) => {
    if (agcOn) {
      // AGC already manages levels; lighter limiting to avoid noise boost
      compressor.threshold.value = -6;
      compressor.knee.value       = 20;
      compressor.ratio.value      = 2;
    } else {
      compressor.threshold.value = -24;
      compressor.knee.value       = 12;
      compressor.ratio.value      = 4;
    }
  };
  applyCompressorMode(vs.autoGainControl);
  // Expose so the live-update subscriber can call it
  compressor._applyAGCMode = applyCompressorMode;

  // ── Final gain (software gain × inputVolume, reduced when AGC on) ─
  const gainNode = audioContext.createGain();
  const baseGain  = IS_ELECTRON ? 2.8 : 1.5;
  const agcFactor = vs.autoGainControl ? 0.5 : 1.0;
  gainNode.gain.value = baseGain * vs.inputVolume * (vs.inputGain / 1.5) * agcFactor;

  // ── Connect chain — always the full path ──────────────────────────
  // Bypassing is handled *inside* the scriptProcessor, not by rewiring.
  sourceNode.connect(muteGain);
  muteGain.connect(highPassFilter);
  highPassFilter.connect(notchFilter);
  notchFilter.connect(scriptProcessor);
  scriptProcessor.connect(compressor);
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
  return onVoiceSettingsChange(async (vs) => {
    const baseGain = IS_ELECTRON ? 2.8 : 1.5;
    const userId = localStorage.getItem('userId');
    const filters = filtersRef?.current?.[userId];

    // ── 1. Apply WebRTC track constraints live (EC / NS / AGC) ──────
    //    This makes toggles take effect immediately during a call.
    if (localStreamRef?.current) {
      const track = localStreamRef.current.getAudioTracks()[0];
      if (track && track.readyState === 'live') {
        try {
          await track.applyConstraints({
            echoCancellation: vs.echoCancellation,
            noiseSuppression: vs.noiseSuppression,
            autoGainControl:  vs.autoGainControl,
          });
          console.log('[AudioEngine] Track constraints applied live');
        } catch (e) {
          console.warn('[AudioEngine] applyConstraints failed:', e);
        }
      }
    }

    // ── 2. Patch the Web Audio filter chain in-place ─────────────────
    if (filters) {
      // Noise gate: toggle bypass and update threshold
      if (filters.scriptProcessor) {
        if (filters.scriptProcessor._setBypass) {
          filters.scriptProcessor._setBypass(!vs.noiseSuppression);
        }
        if (filters.scriptProcessor._setThreshold) {
          filters.scriptProcessor._setThreshold(vs.noiseGateThreshold);
        }
      }

      // Compressor: adapt to AGC mode
      if (filters.compressor && filters.compressor._applyAGCMode) {
        filters.compressor._applyAGCMode(vs.autoGainControl);
      }

      // Final gain (reduced when AGC is on to prevent noise amplification)
      if (filters.gainNode) {
        try {
          const agcFactor = vs.autoGainControl ? 0.5 : 1.0;
          filters.gainNode.gain.value = baseGain * vs.inputVolume * (vs.inputGain / 1.5) * agcFactor;
        } catch {}
      }
    }

    // ── 3. Update remote playback gain (outputVolume) ────────────────
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
