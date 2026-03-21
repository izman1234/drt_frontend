import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  loadVoiceSettings,
  updateVoiceSettings,
  resetVoiceSettings,
  onVoiceSettingsChange,
} from '../voiceSettings';
import { createAudioFilters } from '../audioEngine';
import Twemoji from './Twemoji';
import './VoiceSettings.css';

/* ── Helpers ───────────────────────────────────────────────────────── */

/** Debounce wrapper — returns a debounced version of `fn`. */
function useDebouncedCallback(fn, delay) {
  const timer = useRef(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback((...args) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => fn(...args), delay);
  }, [fn, delay]);
}

/** Format 0-2 float as "0 – 200 %" label. */
const pct = (v) => `${Math.round(v * 100)}%`;

/* ── Component ─────────────────────────────────────────────────────── */

function VoiceSettings() {
  // ── Settings state (source of truth = localStorage) ─────────────
  const [settings, setSettings] = useState(loadVoiceSettings);

  // ── Device lists ────────────────────────────────────────────────
  const [inputDevices, setInputDevices] = useState([]);
  const [outputDevices, setOutputDevices] = useState([]);

  // ── Mic test state ──────────────────────────────────────────────
  const [micTestActive, setMicTestActive] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [testError, setTestError] = useState('');

  // ── Permission state ────────────────────────────────────────────
  const [micPermission, setMicPermission] = useState('prompt'); // granted | denied | prompt

  // ── Device-disappeared warning ──────────────────────────────────
  const [deviceWarning, setDeviceWarning] = useState('');

  // ── Refs for audio resources ────────────────────────────────────
  const testStreamRef = useRef(null);
  const testAudioCtxRef = useRef(null);
  const testAnalyserRef = useRef(null);
  const testFiltersRef = useRef(null);
  const loopbackGainRef = useRef(null);
  const meterRAFRef = useRef(null);

  /* ── Enumerate devices ───────────────────────────────────────────── */
  const enumerateDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter(d => d.kind === 'audioinput');
      const outputs = devices.filter(d => d.kind === 'audiooutput');
      setInputDevices(inputs);
      setOutputDevices(outputs);

      // Check if selected devices still exist
      const currentSettings = loadVoiceSettings();
      let changed = false;
      const updates = {};
      if (currentSettings.inputDeviceId !== 'default' &&
          !inputs.some(d => d.deviceId === currentSettings.inputDeviceId)) {
        updates.inputDeviceId = 'default';
        changed = true;
        setDeviceWarning('Your selected microphone was disconnected. Falling back to system default.');
      }
      if (currentSettings.outputDeviceId !== 'default' &&
          !outputs.some(d => d.deviceId === currentSettings.outputDeviceId)) {
        updates.outputDeviceId = 'default';
        changed = true;
        setDeviceWarning('Your selected speaker was disconnected. Falling back to system default.');
      }
      if (changed) {
        const merged = updateVoiceSettings(updates);
        setSettings(merged);
      }
    } catch (e) {
      console.error('[VoiceSettings] enumerateDevices failed:', e);
    }
  }, []);

  /* ── Check mic permission ────────────────────────────────────────── */
  const checkPermission = useCallback(async () => {
    try {
      if (navigator.permissions && navigator.permissions.query) {
        const result = await navigator.permissions.query({ name: 'microphone' });
        setMicPermission(result.state);
        result.onchange = () => setMicPermission(result.state);
      }
    } catch {
      // permissions API not available
    }
  }, []);

  /* ── On mount: enumerate + listen for device changes ─────────────── */
  useEffect(() => {
    enumerateDevices();
    checkPermission();
    const handleDeviceChange = () => enumerateDevices();
    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
      // Cleanup any running mic test
      stopMicTest();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Setting updaters (debounced for sliders) ────────────────────── */
  const persistSettings = useCallback((partial) => {
    const merged = updateVoiceSettings(partial);
    setSettings(merged);
  }, []);

  const debouncedPersist = useDebouncedCallback(persistSettings, 150);

  const handleSliderChange = (key, value) => {
    // Immediate visual feedback
    setSettings(prev => ({ ...prev, [key]: value }));
    // Debounced persistence + event
    debouncedPersist({ [key]: value });
  };

  const handleSelectChange = (key, value) => {
    persistSettings({ [key]: value });
    // Clear device warning when user explicitly picks a device
    if (key === 'inputDeviceId' || key === 'outputDeviceId') {
      setDeviceWarning('');
    }
  };

  const handleToggleChange = (key, value) => {
    persistSettings({ [key]: value });
  };

  const handleReset = () => {
    const defaults = resetVoiceSettings();
    setSettings(defaults);
    setDeviceWarning('');
  };

  /* ── Live-patch mic test pipeline when settings change ────────────── */
  useEffect(() => {
    if (!micTestActive) return;

    const IS_ELECTRON = !!(window.electron);
    const baseGain = IS_ELECTRON ? 1.2 : 1;

    const unsub = onVoiceSettingsChange(async (vs) => {
      const filters = testFiltersRef.current;

      // 1. Apply track constraints live (EC / AGC)
      if (testStreamRef.current) {
        const track = testStreamRef.current.getAudioTracks()[0];
        if (track && track.readyState === 'live') {
          try {
            await track.applyConstraints({
              echoCancellation: vs.echoCancellation,
              noiseSuppression: true,
              autoGainControl: vs.autoGainControl,
            });
          } catch (e) {
            console.warn('[VoiceSettings] applyConstraints failed:', e);
          }
        }
      }

      // 2. Patch the filter chain in-place
      if (filters) {
        // RNNoise: toggle bypass and noise gate
        if (filters.rnnoiseNode) {
          if (filters.rnnoiseNode._setBypass) {
            filters.rnnoiseNode._setBypass(!vs.noiseSuppression);
          }
          if (filters.rnnoiseNode._setGateThreshold) {
            filters.rnnoiseNode._setGateThreshold(vs.noiseGateThreshold ?? -50);
          }
        }

        // Compressor: adapt to AGC mode
        if (filters.compressor && filters.compressor._applyAGCMode) {
          filters.compressor._applyAGCMode(vs.autoGainControl);
        }

        // Final gain
        if (filters.gainNode) {
          try {
            const agcFactor = vs.autoGainControl ? 0.5 : 1.0;
            filters.gainNode.gain.value = baseGain * vs.inputVolume * (vs.inputGain / 1.5) * agcFactor;
          } catch {}
        }
      }
    });

    return unsub;
  }, [micTestActive]);

  /* ── Mic test ────────────────────────────────────────────────────── */

  const startMicTest = async () => {
    setTestError('');

    try {
      const constraints = {
        audio: {
          deviceId: settings.inputDeviceId !== 'default' ? { exact: settings.inputDeviceId } : undefined,
          echoCancellation: settings.echoCancellation,
          noiseSuppression: true,     // Always stack Chromium NS with RNNoise
          autoGainControl: settings.autoGainControl,
          sampleRate: { ideal: 48000 },
        },
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      testStreamRef.current = stream;

      // Audio context
      const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
      if (ctx.state === 'suspended') await ctx.resume();
      testAudioCtxRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);

      // ── Run through the FULL audio processing pipeline ────────────
      // This is the same chain used in live voice chat so the test mic
      // sounds exactly like what other participants would hear.
      const filters = await createAudioFilters(ctx, source);
      testFiltersRef.current = filters;

      // The last node in the pipeline is filters.gainNode
      const pipelineOutput = filters.gainNode;

      // Analyser for level meter — reads the processed signal
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      pipelineOutput.connect(analyser);
      testAnalyserRef.current = analyser;

      // Loopback — always active so the user hears exactly what others
      // would hear through the full processing pipeline.
      const loopback = ctx.createGain();
      loopback.gain.value = 0.8;
      pipelineOutput.connect(loopback);
      loopback.connect(ctx.destination);
      loopbackGainRef.current = loopback;

      setMicTestActive(true);
      setMicPermission('granted');
      enumerateDevices(); // Re-enumerate to get friendly names after permission grant

      // Level meter animation
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateMeter = () => {
        if (!testAnalyserRef.current) return;
        testAnalyserRef.current.getByteFrequencyData(dataArray);
        const sum = dataArray.reduce((a, b) => a + b, 0);
        const avg = sum / dataArray.length;
        setMicLevel(Math.min(avg / 128, 1)); // normalize to 0-1
        meterRAFRef.current = requestAnimationFrame(updateMeter);
      };
      meterRAFRef.current = requestAnimationFrame(updateMeter);
    } catch (err) {
      console.error('[VoiceSettings] Mic test error:', err);
      if (err.name === 'NotAllowedError') {
        setTestError('Microphone access was denied. Please allow microphone permissions in your browser/OS settings.');
        setMicPermission('denied');
      } else if (err.name === 'NotFoundError') {
        setTestError('No microphone found. Please connect a microphone and try again.');
      } else if (err.name === 'NotReadableError') {
        setTestError('Microphone is busy or unavailable. Another application may be using it.');
      } else {
        setTestError(`Failed to access microphone: ${err.message}`);
      }
    }
  };

  const stopMicTest = () => {
    // Stop animation frame
    if (meterRAFRef.current) {
      cancelAnimationFrame(meterRAFRef.current);
      meterRAFRef.current = null;
    }

    // Free RNNoise WASM resources before closing AudioContext
    if (testFiltersRef.current?.rnnoiseNode?._destroy) {
      try { testFiltersRef.current.rnnoiseNode._destroy(); } catch {}
    }

    // Close audio context and stream
    if (testAudioCtxRef.current && testAudioCtxRef.current.state !== 'closed') {
      try { testAudioCtxRef.current.close(); } catch {}
    }
    testAudioCtxRef.current = null;
    testAnalyserRef.current = null;
    testFiltersRef.current = null;
    loopbackGainRef.current = null;

    if (testStreamRef.current) {
      testStreamRef.current.getTracks().forEach(t => t.stop());
      testStreamRef.current = null;
    }

    setMicTestActive(false);
    setMicLevel(0);
  };

  /* ── Render helpers ──────────────────────────────────────────────── */

  const renderMeter = (level) => (
    <div className="voice-meter-container">
      <div
        className={`voice-meter-fill${level > 0.9 ? ' clipping' : ''}`}
        style={{ width: `${Math.round(level * 100)}%` }}
      />
    </div>
  );

  const renderToggle = (key, label, description) => (
    <div className="voice-toggle-row">
      <div className="voice-toggle-info">
        <span className="voice-toggle-name">{label}</span>
        {description && <span className="voice-toggle-desc">{description}</span>}
      </div>
      <label className="voice-toggle-switch">
        <input
          type="checkbox"
          checked={settings[key]}
          onChange={(e) => handleToggleChange(key, e.target.checked)}
        />
        <span className="voice-toggle-slider" />
      </label>
    </div>
  );

  /* ── Render ──────────────────────────────────────────────────────── */

  return (
    <div className="voice-settings">
      {/* ── INPUT SECTION ──────────────────────────────────────────── */}
      <div className="voice-section">
        <h3 className="voice-section-title">Input Device</h3>

        <div className="voice-select-row">
          <label className="voice-select-label">Microphone</label>
          <select
            className="voice-select"
            value={settings.inputDeviceId}
            onChange={(e) => handleSelectChange('inputDeviceId', e.target.value)}
          >
            <option value="default">System Default</option>
            {inputDevices
              .filter(d => d.deviceId !== 'default' && d.deviceId !== 'communications')
              .map(d => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Microphone (${d.deviceId.slice(0, 8)}…)`}
                </option>
            ))}
          </select>
        </div>

        <div className="voice-slider-row">
          <div className="voice-slider-header">
            <span className="voice-slider-label">Input Volume</span>
            <span className="voice-slider-value">{pct(settings.inputVolume)}</span>
          </div>
          <div className="voice-slider-track">
            <input
              type="range"
              className="voice-slider"
              min="0"
              max="2"
              step="0.01"
              value={settings.inputVolume}
              onChange={(e) => handleSliderChange('inputVolume', parseFloat(e.target.value))}
            />
          </div>
        </div>

        {micTestActive && (
          <>
            <div className="voice-slider-header" style={{ marginBottom: 2 }}>
              <span className="voice-slider-label">Mic Level</span>
            </div>
            {renderMeter(micLevel)}
          </>
        )}
      </div>

      <hr className="voice-section-divider" />

      {/* ── OUTPUT SECTION ─────────────────────────────────────────── */}
      <div className="voice-section">
        <h3 className="voice-section-title">Output Device</h3>

        <div className="voice-select-row">
          <label className="voice-select-label">Speaker / Headphones</label>
          {outputDevices.length > 0 ? (
            <select
              className="voice-select"
              value={settings.outputDeviceId}
              onChange={(e) => handleSelectChange('outputDeviceId', e.target.value)}
            >
              <option value="default">System Default</option>
              {outputDevices
                .filter(d => d.deviceId !== 'default' && d.deviceId !== 'communications')
                .map(d => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Speaker (${d.deviceId.slice(0, 8)}…)`}
                  </option>
              ))}
            </select>
          ) : (
            <>
              <select className="voice-select" disabled>
                <option>System Default</option>
              </select>
              <div className="voice-warning info">
                <span className="voice-warning-icon">ℹ️</span>
                <span>Output device selection is controlled by your system settings on this platform.</span>
              </div>
            </>
          )}
        </div>

        <div className="voice-slider-row">
          <div className="voice-slider-header">
            <span className="voice-slider-label">Output Volume</span>
            <span className="voice-slider-value">{pct(settings.outputVolume)}</span>
          </div>
          <div className="voice-slider-track">
            <input
              type="range"
              className="voice-slider"
              min="0"
              max="2"
              step="0.01"
              value={settings.outputVolume}
              onChange={(e) => handleSliderChange('outputVolume', parseFloat(e.target.value))}
            />
          </div>
        </div>
      </div>

      <hr className="voice-section-divider" />

      {/* ── PROCESSING SECTION ─────────────────────────────────────── */}
      <div className="voice-section">
        <h3 className="voice-section-title">Audio Processing</h3>

        {renderToggle(
          'noiseSuppression',
          'AI Noise Suppression',
          'Uses an AI model (RNNoise) to remove background noise, keyboard clicks, and other non-speech sounds in real-time.'
        )}
        {settings.noiseSuppression && (
          <div className="voice-slider-row voice-conditional-setting">
            <div className="voice-slider-header">
              <span className="voice-slider-label">Noise Gate Threshold</span>
              <span className="voice-slider-value">{settings.noiseGateThreshold} dB</span>
            </div>
            <div className="voice-slider-track">
              <input
                type="range"
                className="voice-slider"
                min="-60"
                max="-20"
                step="1"
                value={settings.noiseGateThreshold}
                onChange={(e) => handleSliderChange('noiseGateThreshold', parseInt(e.target.value, 10))}
              />
            </div>
            <span className="voice-toggle-desc" style={{ marginTop: -4 }}>
              Sounds below this level are silenced after AI denoising. Lower = more sensitive, higher = more aggressive gating. Set to -60 dB to disable.
            </span>
          </div>
        )}
        {renderToggle(
          'echoCancellation',
          'Echo Cancellation',
          'Prevents your speakers from feeding audio back into your microphone.'
        )}
        {renderToggle(
          'autoGainControl',
          'Automatic Gain Control',
          'Automatically adjusts your microphone volume. Disable for manual control.'
        )}

        <div className="voice-slider-row">
          <div className="voice-slider-header">
            <span className="voice-slider-label">Software Gain</span>
            <span className="voice-slider-value">{settings.inputGain.toFixed(1)}x</span>
          </div>
          <div className="voice-slider-track">
            <input
              type="range"
              className="voice-slider"
              min="0.5"
              max="3"
              step="0.1"
              value={settings.inputGain}
              onChange={(e) => handleSliderChange('inputGain', parseFloat(e.target.value))}
            />
          </div>
          <span className="voice-toggle-desc" style={{ marginTop: -4 }}>
            Amplifies your microphone signal in software. Higher values may introduce clipping.
          </span>
        </div>
      </div>

      <hr className="voice-section-divider" />

      {/* ── MIC TEST SECTION ───────────────────────────────────────── */}
      <div className="voice-section">
        <h3 className="voice-section-title">Test Microphone</h3>

        <div className="voice-test-panel">
          <div className="voice-test-controls">
            {!micTestActive ? (
              <button className="voice-test-btn start" onClick={startMicTest}>
                <Twemoji emoji="🎤" size={16} /> Start Test
              </button>
            ) : (
              <button className="voice-test-btn stop" onClick={stopMicTest}>
                <Twemoji emoji="⏹" size={16} /> Stop Test
              </button>
            )}
          </div>

          {micTestActive && (
            <>
              <div className="voice-test-status recording">
                <span className="voice-test-dot" />
                Listening — you'll hear yourself through the full audio pipeline
              </div>
              {renderMeter(micLevel)}
              <div className="voice-warning warn">
                <span className="voice-warning-icon"><Twemoji emoji="🎧" size={16} /></span>
                <span>Use headphones to avoid audio feedback!</span>
              </div>
            </>
          )}

          {testError && (
            <div className="voice-warning error">
              <span className="voice-warning-icon"><Twemoji emoji="❌" size={16} /></span>
              <span>{testError}</span>
            </div>
          )}
        </div>
      </div>

      <hr className="voice-section-divider" />

      {/* ── TROUBLESHOOTING SECTION ────────────────────────────────── */}
      <div className="voice-section">
        <h3 className="voice-section-title">Troubleshooting</h3>

        <div className="voice-permission-row">
          <span className={`voice-permission-dot ${micPermission}`} />
          <span className="voice-permission-label">
            Microphone permission: <strong style={{ color: '#e9d5ff' }}>{micPermission}</strong>
          </span>
        </div>

        {micPermission === 'denied' && (
          <div className="voice-warning error">
            <span className="voice-warning-icon"><Twemoji emoji="🔒" size={16} /></span>
            <span>
              Microphone access is blocked. Please allow microphone permissions in your browser or system settings, then reload the app.
            </span>
          </div>
        )}

        {deviceWarning && (
          <div className="voice-warning warn">
            <span className="voice-warning-icon"><Twemoji emoji="⚠️" size={16} /></span>
            <span>{deviceWarning}</span>
          </div>
        )}

        <div className="voice-warning info">
          <span className="voice-warning-icon"><Twemoji emoji="💡" size={16} /></span>
          <span>
            If you're having audio issues, try selecting a different device, resetting to defaults, or restarting the app.
            On some platforms, output device selection may only be changed through system audio settings.
          </span>
        </div>
      </div>

      <hr className="voice-section-divider" />

      {/* ── RESET ──────────────────────────────────────────────────── */}
      <button className="voice-reset-btn" onClick={handleReset}>
        <Twemoji emoji="🔄" size={16} /> Reset to Defaults
      </button>
    </div>
  );
}

export default VoiceSettings;
