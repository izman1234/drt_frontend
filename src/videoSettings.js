const STORAGE_KEY = 'drt_videoSettings';

export const VIDEO_DEFAULTS = {
  cameraDeviceId: 'default',
  cameraResolution: '720p',
  cameraFrameRate: 30,
  mirrorSelfView: true,
  screenResolution: '720p',
  screenFrameRate: 30,
};

export const VIDEO_RESOLUTIONS = {
  '480p': { width: 854, height: 480 },
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
};

const cloneDefaults = () => JSON.parse(JSON.stringify(VIDEO_DEFAULTS));
const listeners = new Set();

const notify = (settings) => {
  listeners.forEach((fn) => {
    try { fn(settings); } catch (e) { console.error('[VideoSettings] listener error', e); }
  });
};

export function loadVideoSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return { ...cloneDefaults(), ...JSON.parse(raw) };
    }
  } catch (e) {
    console.warn('[VideoSettings] Failed to parse stored settings; using defaults', e);
  }
  return cloneDefaults();
}

export function saveVideoSettings(settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  notify(settings);
}

export function updateVideoSettings(partial) {
  const merged = { ...loadVideoSettings(), ...partial };
  saveVideoSettings(merged);
  return merged;
}

export function resetVideoSettings() {
  const defaults = cloneDefaults();
  saveVideoSettings(defaults);
  return defaults;
}

export function onVideoSettingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getCameraConstraints(overrides = {}) {
  const settings = loadVideoSettings();
  const resolution = VIDEO_RESOLUTIONS[settings.cameraResolution] || VIDEO_RESOLUTIONS['720p'];
  return {
    video: {
      deviceId: settings.cameraDeviceId !== 'default' ? { exact: settings.cameraDeviceId } : undefined,
      width: { ideal: resolution.width },
      height: { ideal: resolution.height },
      frameRate: { ideal: settings.cameraFrameRate, max: settings.cameraFrameRate },
      ...overrides,
    },
    audio: false,
  };
}

export function getScreenConstraints() {
  const settings = loadVideoSettings();
  const resolution = VIDEO_RESOLUTIONS[settings.screenResolution] || VIDEO_RESOLUTIONS['720p'];
  return {
    video: {
      width: { ideal: resolution.width },
      height: { ideal: resolution.height },
      frameRate: { ideal: settings.screenFrameRate, max: settings.screenFrameRate },
    },
    audio: false,
  };
}
