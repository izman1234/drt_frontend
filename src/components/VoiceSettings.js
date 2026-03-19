import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  loadVoiceSettings,
  updateVoiceSettings,
  resetVoiceSettings,
} from '../voiceSettings';
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

/** Format dB threshold for display. */
const dbLabel = (v) => `${v} dB`;

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
  const [loopbackActive, setLoopbackActive] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState(null);
  const [isPlayingBack, setIsPlayingBack] = useState(false);
  const [testError, setTestError] = useState('');
  const [recordingTime, setRecordingTime] = useState(0);

  // ── Permission state ────────────────────────────────────────────
  const [micPermission, setMicPermission] = useState('prompt'); // granted | denied | prompt

  // ── Device-disappeared warning ──────────────────────────────────
  const [deviceWarning, setDeviceWarning] = useState('');

  // ── Refs for audio resources ────────────────────────────────────
  const testStreamRef = useRef(null);
  const testAudioCtxRef = useRef(null);
  const testAnalyserRef = useRef(null);
  const testGainRef = useRef(null);
  const loopbackGainRef = useRef(null);
  const meterRAFRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const playbackAudioRef = useRef(null);
  const recordingTimerRef = useRef(null);

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

  /* ── Mic test ────────────────────────────────────────────────────── */

  const startMicTest = async () => {
    setTestError('');
    setRecordedBlob(null);
    setRecordingTime(0);
    recordedChunksRef.current = [];

    try {
      const constraints = {
        audio: {
          deviceId: settings.inputDeviceId !== 'default' ? { exact: settings.inputDeviceId } : undefined,
          echoCancellation: settings.echoCancellation,
          noiseSuppression: settings.noiseSuppression,
          autoGainControl: settings.autoGainControl,
          sampleRate: { ideal: 48000 },
        },
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      testStreamRef.current = stream;

      // Audio context
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') await ctx.resume();
      testAudioCtxRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);

      // Input gain
      const gain = ctx.createGain();
      gain.gain.value = settings.inputVolume * settings.inputGain;
      testGainRef.current = gain;
      source.connect(gain);

      // Analyser for level meter
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      gain.connect(analyser);
      testAnalyserRef.current = analyser;

      // Loopback gain (initially 0)
      const loopback = ctx.createGain();
      loopback.gain.value = loopbackActive ? 0.8 : 0;
      gain.connect(loopback);
      loopback.connect(ctx.destination);
      loopbackGainRef.current = loopback;

      // MediaRecorder for recording test (up to 5 seconds)
      try {
        const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) recordedChunksRef.current.push(e.data);
        };
        recorder.onstop = () => {
          if (recordedChunksRef.current.length > 0) {
            const blob = new Blob(recordedChunksRef.current, { type: 'audio/webm' });
            setRecordedBlob(blob);
          }
        };
        recorder.start();
        mediaRecorderRef.current = recorder;
      } catch (recErr) {
        console.warn('[VoiceSettings] MediaRecorder not supported:', recErr);
      }

      setMicTestActive(true);
      setMicPermission('granted');
      enumerateDevices(); // Re-enumerate to get friendly names after permission grant

      // Start recording timer; auto-stop at 5 seconds
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime(prev => {
          if (prev >= 5) {
            stopMicTest();
            return 5;
          }
          return prev + 1;
        });
      }, 1000);

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
    // Stop recording timer
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    // Stop MediaRecorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try { mediaRecorderRef.current.stop(); } catch {}
    }
    mediaRecorderRef.current = null;

    // Stop animation frame
    if (meterRAFRef.current) {
      cancelAnimationFrame(meterRAFRef.current);
      meterRAFRef.current = null;
    }

    // Close audio context and stream
    if (testAudioCtxRef.current && testAudioCtxRef.current.state !== 'closed') {
      try { testAudioCtxRef.current.close(); } catch {}
    }
    testAudioCtxRef.current = null;
    testAnalyserRef.current = null;
    testGainRef.current = null;
    loopbackGainRef.current = null;

    if (testStreamRef.current) {
      testStreamRef.current.getTracks().forEach(t => t.stop());
      testStreamRef.current = null;
    }

    setMicTestActive(false);
    setMicLevel(0);
    setLoopbackActive(false);
  };

  const toggleLoopback = () => {
    const newVal = !loopbackActive;
    setLoopbackActive(newVal);
    if (loopbackGainRef.current) {
      loopbackGainRef.current.gain.value = newVal ? 0.8 : 0;
    }
  };

  const playRecording = async () => {
    if (!recordedBlob) return;
    setIsPlayingBack(true);
    try {
      const url = URL.createObjectURL(recordedBlob);
      const audio = new Audio(url);
      playbackAudioRef.current = audio;

      // Try to set output device if supported
      if (audio.setSinkId && settings.outputDeviceId !== 'default') {
        try {
          await audio.setSinkId(settings.outputDeviceId);
        } catch (e) {
          console.warn('[VoiceSettings] setSinkId failed:', e);
        }
      }

      audio.volume = Math.min(settings.outputVolume, 1.0);
      audio.onended = () => {
        setIsPlayingBack(false);
        URL.revokeObjectURL(url);
      };
      audio.onerror = () => {
        setIsPlayingBack(false);
        URL.revokeObjectURL(url);
      };
      await audio.play();
    } catch (e) {
      console.error('[VoiceSettings] playback error:', e);
      setIsPlayingBack(false);
    }
  };

  // Update loopback / gain in real-time when settings change during test
  useEffect(() => {
    if (testGainRef.current) {
      testGainRef.current.gain.value = settings.inputVolume * settings.inputGain;
    }
  }, [settings.inputVolume, settings.inputGain]);

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
          'Noise Suppression',
          'Reduces background noise captured by your microphone. May slightly affect voice quality.'
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

        <div className="voice-slider-row">
          <div className="voice-slider-header">
            <span className="voice-slider-label">Noise Gate Threshold</span>
            <span className="voice-slider-value">{dbLabel(settings.noiseGateThreshold)}</span>
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
            Sounds below this level are silenced. Lower = more sensitive, higher = more aggressive gating.
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

            {micTestActive && (
              <button
                className={`voice-test-btn loopback${loopbackActive ? ' active' : ''}`}
                onClick={toggleLoopback}
                title="Route your microphone to your speakers so you can hear yourself. Use headphones to avoid feedback!"
              >
                {loopbackActive ? <><Twemoji emoji="🔊" size={16} /> Loopback On</> : <><Twemoji emoji="🔇" size={16} /> Loopback Off</>}
              </button>
            )}

            {recordedBlob && !micTestActive && (
              <button
                className="voice-test-btn playback"
                onClick={playRecording}
                disabled={isPlayingBack}
              >
                {isPlayingBack ? <><Twemoji emoji="▶️" size={16} /> Playing...</> : <><Twemoji emoji="▶️" size={16} /> Play Recording</>}
              </button>
            )}
          </div>

          {micTestActive && (
            <>
              <div className="voice-test-status recording">
                <span className="voice-test-dot" />
                Recording… {recordingTime}s / 5s
              </div>
              {renderMeter(micLevel)}
            </>
          )}

          {loopbackActive && micTestActive && (
            <div className="voice-warning warn">
              <span className="voice-warning-icon"><Twemoji emoji="⚠️" size={16} /></span>
              <span>Loopback is active — use headphones to avoid audio feedback!</span>
            </div>
          )}

          {testError && (
            <div className="voice-warning error">
              <span className="voice-warning-icon"><Twemoji emoji="❌" size={16} /></span>
              <span>{testError}</span>
            </div>
          )}

          {!micTestActive && !testError && recordedBlob && (
            <div className="voice-warning success">
              <span className="voice-warning-icon"><Twemoji emoji="✅" size={16} /></span>
              <span>Recording captured successfully. Click "Play Recording" to hear yourself.</span>
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
