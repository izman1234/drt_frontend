import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  loadVideoSettings,
  updateVideoSettings,
  resetVideoSettings,
  getCameraConstraints,
} from '../videoSettings';
import './VideoSettings.css';

const pct = (value) => `${value} fps`;

function VideoSettings() {
  const [settings, setSettings] = useState(loadVideoSettings);
  const [cameras, setCameras] = useState([]);
  const [cameraPermission, setCameraPermission] = useState('prompt');
  const [previewActive, setPreviewActive] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const previewVideoRef = useRef(null);
  const previewStreamRef = useRef(null);

  const enumerateDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setCameras(devices.filter(device => device.kind === 'videoinput'));
    } catch (e) {
      console.error('[VideoSettings] enumerateDevices failed:', e);
    }
  }, []);

  const checkPermission = useCallback(async () => {
    try {
      if (navigator.permissions?.query) {
        const result = await navigator.permissions.query({ name: 'camera' });
        setCameraPermission(result.state);
        result.onchange = () => setCameraPermission(result.state);
      }
    } catch {
      // permissions API is optional
    }
  }, []);

  useEffect(() => {
    enumerateDevices();
    checkPermission();
    const handleDeviceChange = () => enumerateDevices();
    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
      stopPreview();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enumerateDevices, checkPermission]);

  const persist = (partial) => {
    const merged = updateVideoSettings(partial);
    setSettings(merged);
  };

  const startPreview = async () => {
    setPreviewError('');
    try {
      stopPreview();
      const stream = await navigator.mediaDevices.getUserMedia(getCameraConstraints());
      previewStreamRef.current = stream;
      if (previewVideoRef.current) {
        previewVideoRef.current.srcObject = stream;
        await previewVideoRef.current.play().catch(() => {});
      }
      setPreviewActive(true);
      setCameraPermission('granted');
      enumerateDevices();
    } catch (err) {
      console.error('[VideoSettings] Camera preview failed:', err);
      setPreviewActive(false);
      if (err.name === 'NotAllowedError') {
        setCameraPermission('denied');
        setPreviewError('Camera access was denied. Allow camera permissions in your system settings and try again.');
      } else if (err.name === 'NotFoundError') {
        setPreviewError('No camera was found.');
      } else if (err.name === 'NotReadableError') {
        setPreviewError('The camera is busy or unavailable.');
      } else {
        setPreviewError(`Failed to start camera preview: ${err.message}`);
      }
    }
  };

  const stopPreview = () => {
    if (previewStreamRef.current) {
      previewStreamRef.current.getTracks().forEach(track => track.stop());
      previewStreamRef.current = null;
    }
    if (previewVideoRef.current) {
      previewVideoRef.current.srcObject = null;
    }
    setPreviewActive(false);
  };

  const handleReset = () => {
    const defaults = resetVideoSettings();
    setSettings(defaults);
  };

  return (
    <div className="video-settings">
      <div className="video-section">
        <h3 className="video-section-title">Camera</h3>

        <div className="video-select-row">
          <label className="video-select-label">Camera Device</label>
          <select
            className="video-select"
            value={settings.cameraDeviceId}
            onChange={(e) => persist({ cameraDeviceId: e.target.value })}
          >
            <option value="default">System Default</option>
            {cameras
              .filter(device => device.deviceId !== 'default' && device.deviceId !== 'communications')
              .map(device => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Camera (${device.deviceId.slice(0, 8)})`}
                </option>
              ))}
          </select>
        </div>

        <div className="video-setting-grid">
          <div className="video-select-row">
            <label className="video-select-label">Resolution</label>
            <select
              className="video-select"
              value={settings.cameraResolution}
              onChange={(e) => persist({ cameraResolution: e.target.value })}
            >
              <option value="480p">480p</option>
              <option value="720p">720p</option>
              <option value="1080p">1080p</option>
            </select>
          </div>

          <div className="video-select-row">
            <label className="video-select-label">Frame Rate</label>
            <select
              className="video-select"
              value={settings.cameraFrameRate}
              onChange={(e) => persist({ cameraFrameRate: parseInt(e.target.value, 10) })}
            >
              <option value={15}>{pct(15)}</option>
              <option value={30}>{pct(30)}</option>
              <option value={60}>{pct(60)}</option>
            </select>
          </div>
        </div>

        <div className="video-toggle-row">
          <div className="video-toggle-info">
            <span className="video-toggle-name">Mirror Self View</span>
            <span className="video-toggle-desc">Only mirrors your local preview; other users see the normal camera feed.</span>
          </div>
          <label className="video-toggle-switch">
            <input
              type="checkbox"
              checked={settings.mirrorSelfView}
              onChange={(e) => persist({ mirrorSelfView: e.target.checked })}
            />
            <span className="video-toggle-slider" />
          </label>
        </div>

        <div className="video-preview-panel">
          <video
            ref={previewVideoRef}
            className={`video-preview${settings.mirrorSelfView ? ' mirrored' : ''}`}
            muted
            playsInline
          />
          <div className="video-preview-controls">
            {!previewActive ? (
              <button className="video-test-btn start" onClick={startPreview}>Start Preview</button>
            ) : (
              <button className="video-test-btn stop" onClick={stopPreview}>Stop Preview</button>
            )}
          </div>
        </div>

        {previewError && <div className="video-warning error">{previewError}</div>}
        <div className={`video-permission-row ${cameraPermission}`}>
          Camera permission: <strong>{cameraPermission}</strong>
        </div>
      </div>

      <hr className="video-section-divider" />

      <div className="video-section">
        <h3 className="video-section-title">Screen Share</h3>
        <div className="video-setting-grid">
          <div className="video-select-row">
            <label className="video-select-label">Share Resolution</label>
            <select
              className="video-select"
              value={settings.screenResolution}
              onChange={(e) => persist({ screenResolution: e.target.value })}
            >
              <option value="480p">480p</option>
              <option value="720p">720p</option>
              <option value="1080p">1080p</option>
            </select>
          </div>

          <div className="video-select-row">
            <label className="video-select-label">Share Frame Rate</label>
            <select
              className="video-select"
              value={settings.screenFrameRate}
              onChange={(e) => persist({ screenFrameRate: parseInt(e.target.value, 10) })}
            >
              <option value={15}>{pct(15)}</option>
              <option value={30}>{pct(30)}</option>
              <option value={60}>{pct(60)}</option>
            </select>
          </div>
        </div>
        <div className="video-warning info">
          Screen share audio is not included in this version. Voice audio continues through the normal voice channel.
        </div>
      </div>

      <button className="video-reset-btn" onClick={handleReset}>Reset to Defaults</button>
    </div>
  );
}

export default VideoSettings;
