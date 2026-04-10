/**
 * audioEngine.js — Centralised audio pipeline that reads from voiceSettings
 * and exposes helpers consumed by VoiceArea.js.
 *
 * Responsibilities
 * ────────────────
 *  • getUserMedia with the persisted input device + WebRTC constraints
 *  • Build the Web Audio filter chain using the persisted settings values
 *  • RNNoise AI noise suppression (main-thread ScriptProcessor with WASM)
 *  • Route remote playback through gain nodes whose volume is driven by
 *    outputVolume from voiceSettings
 *  • Re-apply settings at runtime when the user tweaks a slider / toggle
 *    (via the onVoiceSettingsChange listener)
 *  • Switch input/output devices on-the-fly
 */

import { createRNNWasmModule } from '@jitsi/rnnoise-wasm';
import { loadVoiceSettings, onVoiceSettingsChange } from './voiceSettings';

// Detect Electron
const IS_ELECTRON = !!(window.electron);

/* ── RNNoise constants ──────────────────────────────────────────────── */
const FRAME_SIZE = 480;   // RNNoise fixed frame size (10 ms @ 48 kHz)

/* ── Module singleton ───────────────────────────────────────────────── */
let rnnoiseModulePromise = null;

/**
 * Resolve a public asset URL that works under both
 * `http://localhost:3000` (dev) and `file:///…/build/index.html` (prod).
 */
function publicUrl(filename) {
  return new URL(`./${filename}`, window.location.href).href;
}

/* ────────────────────────────────────────────────────────────────────
 * volumeToGain — convert a linear slider value (0–2) into an
 * exponential gain value so that 200 % actually *sounds* twice as
 * loud.  Uses a power-curve: gain = v²
 * ──────────────────────────────────────────────────────────────────── */
export function volumeToGain(sliderValue) {
  const v = Math.max(0, sliderValue);
  return v * v;
}

/* ────────────────────────────────────────────────────────────────────
 * Initialise the RNNoise WASM module (once, shared across all calls).
 * ──────────────────────────────────────────────────────────────────── */
async function getRNNoiseModule() {
  if (!rnnoiseModulePromise) {
    rnnoiseModulePromise = (async () => {
      // Pre-fetch the WASM binary from public/ — works with file:// too
      const wasmUrl = publicUrl('rnnoise.wasm');
      const resp = await fetch(wasmUrl);
      if (!resp.ok) throw new Error(`Failed to fetch rnnoise.wasm: ${resp.status}`);
      const wasmBinary = await resp.arrayBuffer();

      // Initialise the Emscripten module with the pre-loaded WASM binary
      // so it doesn't try to fetch from a potentially wrong path.
      const module = await createRNNWasmModule({ wasmBinary });
      module._rnnoise_init();
      console.log('[AudioEngine] RNNoise WASM module initialised (double-pass mode)');
      return module;
    })();
  }
  return rnnoiseModulePromise;
}

/* ────────────────────────────────────────────────────────────────────
 * createAudioFilters — Build the full audio processing chain.
 *
 * Chain: source → muteGain → highPass → rnnoiseProcessor → compressor → gainNode
 *
 * **Async** because the RNNoise WASM module must be loaded first.
 * ──────────────────────────────────────────────────────────────────── */
export async function createAudioFilters(audioContext, sourceNode, opts = {}) {
  const vs = { ...loadVoiceSettings(), ...opts };

  // ── Mute control ──────────────────────────────────────────────────
  const muteGain = audioContext.createGain();
  muteGain.gain.value = 1;

  // ── High-pass (remove low rumble < 80 Hz) ─────────────────────────
  const highPassFilter = audioContext.createBiquadFilter();
  highPassFilter.type = 'highpass';
  highPassFilter.frequency.value = 80;
  highPassFilter.Q.value = 0.7;

  // ── RNNoise denoiser (ScriptProcessor, main thread) ───────────────
  let rnnoiseNode = null;
  try {
    const module  = await getRNNoiseModule();
    const state   = module._rnnoise_create(0);
    const state2  = module._rnnoise_create(0);   // second pass for stronger suppression
    if (!state || !state2) throw new Error('rnnoise_create returned null');

    const inPtr   = module._malloc(FRAME_SIZE * 4);
    const outPtr  = module._malloc(FRAME_SIZE * 4);
    if (!inPtr || !outPtr) throw new Error('malloc for RNNoise buffers failed');

    // ── Mutable settings (patched live by subscribeToPipelineUpdates) ─
    let bypassed       = !vs.noiseSuppression;
    let gateThresholdDb = vs.noiseGateThreshold ?? -50;

    // ── RMS noise gate state ─────────────────────────────────────────
    // Simple energy-based gate applied AFTER RNNoise denoising.
    // RNNoise removes noise from speech frames; the gate silences
    // truly quiet periods (nobody talking).
    let gateEnvelope = 1;   // 0 = closed, 1 = open
    let rmsEnvelope  = 0;   // per-sample RMS tracker

    // ── Ring buffers for 128↔480 cadence bridging ────────────────────
    // Output ring pre-filled with 960 zeros (20 ms) so we never
    // underrun — the 480/128 cadence mismatch causes ±448-sample
    // drift that resolves every 15 buffers.
    const RING = FRAME_SIZE * 8;              // generous capacity
    const inRing  = new Float32Array(RING);
    let   inW = 0, inR = 0;
    const outRing = new Float32Array(RING);
    let   outW = FRAME_SIZE * 2, outR = 0;   // pre-fill 960

    const inAvail  = () => (inW  - inR  + RING) % RING;
    const outAvail = () => (outW - outR + RING) % RING;

    // Verify the AudioContext is 48 kHz — RNNoise will NOT work correctly
    // at any other rate (model was trained exclusively on 48 kHz audio).
    if (audioContext.sampleRate !== 48000) {
      console.warn('[AudioEngine] AudioContext sampleRate is', audioContext.sampleRate,
        '— RNNoise requires 48000 Hz!  Denoising quality will be severely degraded.');
    } else {
      console.log('[AudioEngine] AudioContext sampleRate: 48000 Hz ✓');
    }

    rnnoiseNode = audioContext.createScriptProcessor(2048, 1, 1);

    let frameCount = 0;

    // ── Noise gate smoothing coefficients (constant for 48 kHz) ──────
    const gAttack  = 1 - Math.exp(-1 / (0.005  * 48000));  // 5 ms
    const gRelease = 1 - Math.exp(-1 / (0.200  * 48000));  // 200 ms
    const rAttack  = 1 - Math.exp(-1 / (0.002  * 48000));  // 2 ms
    const rRelease = 1 - Math.exp(-1 / (0.020  * 48000));  // 20 ms

    rnnoiseNode.onaudioprocess = (event) => {
      const input  = event.inputBuffer.getChannelData(0);
      const output = event.outputBuffer.getChannelData(0);
      const len    = input.length;

      if (bypassed) {
        output.set(input);
        return;
      }

      // ── Push input into ring buffer ──────────────────────────────
      for (let i = 0; i < len; i++) {
        inRing[(inW + i) % RING] = input[i];
      }
      inW = (inW + len) % RING;

      // ── Denoise complete 480-sample frames ───────────────────────
      while (inAvail() >= FRAME_SIZE) {
        const heapIn = module.HEAPF32;
        const iOff   = inPtr >> 2;
        for (let i = 0; i < FRAME_SIZE; i++) {
          heapIn[iOff + i] = inRing[(inR + i) % RING] * 32768.0;
        }
        inR = (inR + FRAME_SIZE) % RING;

        // Capture input energy BEFORE processing (double-pass overwrites inPtr)
        const isDiagFrame = frameCount % 500 === 0 && frameCount > 0 && frameCount <= 2000;
        let frameInEnergy = 0;
        if (isDiagFrame) {
          for (let j = 0; j < FRAME_SIZE; j++) {
            frameInEnergy += heapIn[iOff + j] * heapIn[iOff + j];
          }
        }

        // ── Double-pass RNNoise for stronger suppression ─────────
        module._rnnoise_process_frame(state, outPtr, inPtr);
        // Feed first-pass output back as second-pass input
        const o1Off = outPtr >> 2;
        for (let j = 0; j < FRAME_SIZE; j++) {
          heapIn[iOff + j] = module.HEAPF32[o1Off + j];
        }
        module._rnnoise_process_frame(state2, outPtr, inPtr);

        const heapOut = module.HEAPF32;
        const oOff    = outPtr >> 2;

        // ── Periodic RMS diagnostic (every ~5s) to confirm denoising ──
        if (isDiagFrame) {
          let outEnergy = 0;
          for (let j = 0; j < FRAME_SIZE; j++) {
            outEnergy += heapOut[oOff + j] * heapOut[oOff + j];
          }
          const inRms  = Math.sqrt(frameInEnergy / FRAME_SIZE);
          const outRms = Math.sqrt(outEnergy / FRAME_SIZE);
          const reductionDb = 20 * Math.log10((outRms + 1e-10) / (inRms + 1e-10));
          console.log(`[AudioEngine] RNNoise diagnostic — inRMS=${inRms.toFixed(1)} outRMS=${outRms.toFixed(1)} reduction=${reductionDb.toFixed(1)} dB`);
        }
        frameCount++;

        for (let i = 0; i < FRAME_SIZE; i++) {
          let s = heapOut[oOff + i] / 32768.0;

          // ── RMS energy gate (post-denoise) ─────────────────────
          if (gateThresholdDb > -60) {        // -60 = effectively off
            const sqr   = s * s;
            const rCoeff = sqr > rmsEnvelope ? rAttack : rRelease;
            rmsEnvelope += (sqr - rmsEnvelope) * rCoeff;

            const rms = Math.sqrt(Math.max(rmsEnvelope, 1e-20));
            const db  = 20 * Math.log10(rms);

            const gTarget = db > gateThresholdDb ? 1 : 0;
            const gCoeff  = gTarget > gateEnvelope ? gAttack : gRelease;
            gateEnvelope += (gTarget - gateEnvelope) * gCoeff;

            s *= gateEnvelope;
          }

          outRing[(outW + i) % RING] = s;
        }
        outW = (outW + FRAME_SIZE) % RING;
      }

      // ── Read denoised samples from output ring ───────────────────
      if (outAvail() >= len) {
        for (let i = 0; i < len; i++) {
          output[i] = outRing[(outR + i) % RING];
        }
        outR = (outR + len) % RING;
      } else {
        // Shouldn't happen after pre-fill, but just in case
        output.set(input);
      }
    };

    // ── Live-update helpers ────────────────────────────────────────
    rnnoiseNode._setBypass         = (b) => { bypassed = b; };
    rnnoiseNode._setGateThreshold  = (v) => { gateThresholdDb = v; };
    rnnoiseNode._destroy    = () => {
      module._rnnoise_destroy(state);
      module._rnnoise_destroy(state2);
      module._free(inPtr);
      module._free(outPtr);
    };

    console.log('[AudioEngine] RNNoise ScriptProcessor created');
  } catch (err) {
    console.warn('[AudioEngine] RNNoise init failed — falling back to passthrough:', err);
    if (rnnoiseNode) { try { rnnoiseNode.disconnect(); } catch {} }
    rnnoiseNode = audioContext.createGain();
    rnnoiseNode.gain.value = 1;
  }

  // ── Compressor — gentler when AGC is active (they overlap) ────────
  const compressor = audioContext.createDynamicsCompressor();
  compressor.attack.value  = 0.003;
  compressor.release.value = 0.15;
  const applyCompressorMode = (agcOn) => {
    if (agcOn) {
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
  compressor._applyAGCMode = applyCompressorMode;

  // ── Final gain (software gain × inputVolume, reduced when AGC on) ─
  const gainNode = audioContext.createGain();
  const baseGain  = IS_ELECTRON ? 1.2 : 1;
  const agcFactor = vs.autoGainControl ? 0.5 : 1.0;
  gainNode.gain.value = baseGain * vs.inputVolume * (vs.inputGain / 1.5) * agcFactor;

  // ── Connect chain ─────────────────────────────────────────────────
  sourceNode.connect(muteGain);
  muteGain.connect(highPassFilter);
  highPassFilter.connect(rnnoiseNode);
  rnnoiseNode.connect(compressor);
  compressor.connect(gainNode);

  return { muteGain, highPassFilter, rnnoiseNode, compressor, gainNode };
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
      noiseSuppression: true,     // Stack Chromium NS with RNNoise for stronger suppression
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
 * applyRemoteGain — set gain on a remote peer's playback
 * ──────────────────────────────────────────────────────────────────── */
export function applyRemoteGain(makeupGain) {
  const vs = loadVoiceSettings();
  if (makeupGain) {
    const electronMakeup = IS_ELECTRON ? 1.2 : 1.0;
    makeupGain.gain.value = volumeToGain(vs.outputVolume) * electronMakeup;
  }
}

/* ────────────────────────────────────────────────────────────────────
 * createRemoteAudioChain — build a gain + compressor/limiter chain
 * for remote peer playback.
 *
 * Chain: source → gainNode → compressor → destination
 * ──────────────────────────────────────────────────────────────────── */
export function createRemoteAudioChain(audioContext, sourceNode, initialGain = 1) {
  // gainNode is for per-user volume control only
  const gainNode = audioContext.createGain();
  gainNode.gain.value = 1;

  const compressor = audioContext.createDynamicsCompressor();
  compressor.threshold.value = -6;
  compressor.knee.value = 6;
  compressor.ratio.value = 12;
  compressor.attack.value = 0.002;
  compressor.release.value = 0.1;

  // makeupGain handles global outputVolume + Electron makeup
  const electronMakeup = IS_ELECTRON ? 1.2 : 1.0;
  const makeupGain = audioContext.createGain();
  makeupGain.gain.value = volumeToGain(initialGain) * electronMakeup;

  sourceNode.connect(gainNode);
  gainNode.connect(compressor);
  compressor.connect(makeupGain);
  makeupGain.connect(audioContext.destination);

  return { gainNode, compressor, makeupGain };
}

/* ────────────────────────────────────────────────────────────────────
 * liveUpdate — subscribe to settings changes and patch the running
 * audio pipeline in real-time.
 *
 * Returns an unsubscribe function.
 * ──────────────────────────────────────────────────────────────────── */
export function subscribeToPipelineUpdates({ filtersRef, remoteGainNodesRef, localStreamRef, audioContextRef, peersRef, audioElementsRef, analyserRef, dataArrayRef, isMutedRef }) {
  // Track previous device IDs to detect changes
  let prevInputDeviceId  = loadVoiceSettings().inputDeviceId;
  let prevOutputDeviceId = loadVoiceSettings().outputDeviceId;
  let switching = false; // guard against concurrent device switches

  return onVoiceSettingsChange(async (vs) => {
    const baseGain = IS_ELECTRON ? 1.2 : 1;
    const userId = localStorage.getItem('userId');
    const filters = filtersRef?.current?.[userId];

    // ── 0. Live input-device switch ──────────────────────────────────
    const inputDeviceChanged = vs.inputDeviceId !== prevInputDeviceId;
    prevInputDeviceId = vs.inputDeviceId;

    if (inputDeviceChanged && localStreamRef?.current && audioContextRef?.current && !switching) {
      switching = true;
      try {
        const audioContext = audioContextRef.current;
        if (audioContext.state === 'suspended') await audioContext.resume().catch(() => {});

        // Get new stream from the selected device
        const constraints = getUserMediaConstraints();
        const newStream = await navigator.mediaDevices.getUserMedia(constraints);

        // Stop old raw tracks
        localStreamRef.current.getAudioTracks().forEach(t => t.stop());
        if (localStreamRef.current._processedStream) {
          localStreamRef.current._processedStream.getTracks().forEach(t => t.stop());
        }

        // Tear down old filters
        if (filters) {
          try { if (filters.rnnoiseNode && filters.rnnoiseNode._destroy) filters.rnnoiseNode._destroy(); } catch {}
        }

        // Build new filter chain
        const source = audioContext.createMediaStreamSource(newStream);
        const newFilters = await createAudioFilters(audioContext, source);
        const destination = audioContext.createMediaStreamDestination();
        newFilters.gainNode.connect(destination);

        // Analyser for speaking detection
        if (analyserRef?.current) {
          const analyser = audioContext.createAnalyser();
          analyser.fftSize = 256;
          newFilters.gainNode.connect(analyser);
          analyserRef.current[userId] = analyser;
          if (dataArrayRef?.current) {
            dataArrayRef.current[userId] = new Uint8Array(analyser.frequencyBinCount);
          }
        }

        // Initialize mute gain
        if (newFilters.muteGain && isMutedRef) {
          newFilters.muteGain.gain.setValueAtTime(
            isMutedRef.current ? 0 : 1,
            audioContext.currentTime
          );
        }

        // Update refs
        localStreamRef.current = newStream;
        localStreamRef.current._processedStream = destination.stream;
        filtersRef.current[userId] = newFilters;

        // Replace track on all peer connections
        const newTrack = destination.stream.getAudioTracks()[0];
        if (peersRef?.current && newTrack) {
          for (const pc of Object.values(peersRef.current)) {
            const sender = pc.getSenders().find(s => s.track?.kind === 'audio');
            if (sender) {
              await sender.replaceTrack(newTrack);
            }
          }
        }

        console.log('[AudioEngine] Input device switched live');
      } catch (e) {
        console.warn('[AudioEngine] Live input device switch failed:', e);
      } finally {
        switching = false;
      }
      // Settings (gain, noise suppression, etc.) are already baked into the
      // new filters via createAudioFilters, so skip to step 3.
    } else {
      // ── 1. Apply WebRTC track constraints live (EC / AGC) ──────────
      if (localStreamRef?.current) {
        const track = localStreamRef.current.getAudioTracks()[0];
        if (track && track.readyState === 'live') {
          try {
            await track.applyConstraints({
              echoCancellation: vs.echoCancellation,
              noiseSuppression: true,               // Stack with RNNoise
              autoGainControl:  vs.autoGainControl,
            });
            console.log('[AudioEngine] Track constraints applied live');
          } catch (e) {
            console.warn('[AudioEngine] applyConstraints failed:', e);
          }
        }
      }

      // ── 2. Patch the Web Audio filter chain in-place ───────────────
      const currentFilters = filtersRef?.current?.[userId];
      if (currentFilters) {
        // RNNoise: toggle bypass and noise gate threshold
        if (currentFilters.rnnoiseNode) {
          if (currentFilters.rnnoiseNode._setBypass) {
            currentFilters.rnnoiseNode._setBypass(!vs.noiseSuppression);
          }
          if (currentFilters.rnnoiseNode._setGateThreshold) {
            currentFilters.rnnoiseNode._setGateThreshold(vs.noiseGateThreshold ?? -50);
          }
        }

        // Compressor: adapt to AGC mode
        if (currentFilters.compressor && currentFilters.compressor._applyAGCMode) {
          currentFilters.compressor._applyAGCMode(vs.autoGainControl);
        }

        // Final gain (reduced when AGC is on)
        if (currentFilters.gainNode) {
          try {
            const agcFactor = vs.autoGainControl ? 0.5 : 1.0;
            currentFilters.gainNode.gain.value = baseGain * vs.inputVolume * (vs.inputGain / 1.5) * agcFactor;
          } catch {}
        }
      }
    }

    // ── 3. Update remote playback gain (outputVolume via makeupGain) ─
    if (remoteGainNodesRef?.current) {
      const electronMakeup = IS_ELECTRON ? 1.2 : 1.0;
      Object.values(remoteGainNodesRef.current).forEach((rg) => {
        if (rg && rg.makeupGain) {
          try {
            rg.makeupGain.gain.value = volumeToGain(vs.outputVolume) * electronMakeup;
          } catch {}
        }
      });
    }

    // ── 4. Live output-device switch ─────────────────────────────────
    const outputDeviceChanged = vs.outputDeviceId !== prevOutputDeviceId;
    prevOutputDeviceId = vs.outputDeviceId;

    if (outputDeviceChanged && audioElementsRef?.current) {
      for (const audioEl of Object.values(audioElementsRef.current)) {
        if (audioEl && audioEl.setSinkId) {
          try {
            await audioEl.setSinkId(vs.outputDeviceId === 'default' ? '' : vs.outputDeviceId);
          } catch (e) {
            console.warn('[AudioEngine] setSinkId failed:', e);
          }
        }
      }
      console.log('[AudioEngine] Output device switched live');
    }

    console.log('[AudioEngine] Pipeline settings updated live');
  });
}
