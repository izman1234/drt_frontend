import React, { useState, useRef, useEffect, useCallback } from 'react';
import './ColorPicker.css';

function ColorPicker({ color, onSave, onClose }) {
  const [hue, setHue] = useState(0);
  const [saturation, setSaturation] = useState(100);
  const [lightness, setLightness] = useState(50);
  const [hexInput, setHexInput] = useState(color || '#a78bba');
  const satLightRef = useRef(null);
  const hueRef = useRef(null);
  const [draggingSL, setDraggingSL] = useState(false);
  const [draggingHue, setDraggingHue] = useState(false);

  // Convert hex to HSL on mount
  useEffect(() => {
    const { h, s, l } = hexToHSL(color || '#a78bba');
    setHue(h);
    setSaturation(s);
    setLightness(l);
    setHexInput(color || '#a78bba');
  }, [color]);

  function hexToHSL(hex) {
    let r = parseInt(hex.slice(1, 3), 16) / 255;
    let g = parseInt(hex.slice(3, 5), 16) / 255;
    let b = parseInt(hex.slice(5, 7), 16) / 255;

    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
        default: break;
      }
    }

    return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
  }

  function hslToHex(h, s, l) {
    s /= 100;
    l /= 100;

    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;

    if (h < 60) { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }

    const toHex = (v) => {
      const hex = Math.round((v + m) * 255).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    };

    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  const currentHex = hslToHex(hue, saturation, lightness);

  // Update hex input when HSL changes
  useEffect(() => {
    setHexInput(currentHex);
  }, [currentHex]);

  const handleHexChange = (e) => {
    const val = e.target.value;
    setHexInput(val);
    if (/^#[0-9a-fA-F]{6}$/.test(val)) {
      const { h, s, l } = hexToHSL(val);
      setHue(h);
      setSaturation(s);
      setLightness(l);
    }
  };

  // Saturation/Lightness picker
  const handleSLInteraction = useCallback((e) => {
    const rect = satLightRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    setSaturation(Math.round(x * 100));
    setLightness(Math.round((1 - y) * 100));
  }, []);

  const handleSLMouseDown = (e) => {
    setDraggingSL(true);
    handleSLInteraction(e);
  };

  // Hue bar
  const handleHueInteraction = useCallback((e) => {
    const rect = hueRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHue(Math.round(x * 360));
  }, []);

  const handleHueMouseDown = (e) => {
    setDraggingHue(true);
    handleHueInteraction(e);
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (draggingSL) handleSLInteraction(e);
      if (draggingHue) handleHueInteraction(e);
    };
    const handleMouseUp = () => {
      setDraggingSL(false);
      setDraggingHue(false);
    };
    if (draggingSL || draggingHue) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingSL, draggingHue, handleSLInteraction, handleHueInteraction]);

  // Preset colors
  const presets = [
    '#a78bba', '#9d43e1', '#e74c3c', '#e91e63', '#ff9800',
    '#ffeb3b', '#4caf50', '#00bcd4', '#2196f3', '#3f51b5',
    '#ffffff', '#b9bbbe',
  ];

  return (
    <div className="color-picker-backdrop" onClick={onClose}>
      <div className="color-picker-modal" onClick={(e) => e.stopPropagation()}>
        <div className="color-picker-header">
          <h3>Choose a Color</h3>
          <button className="color-picker-close-btn" onClick={onClose} title="Close">×</button>
        </div>

        <div className="color-picker-body">
          {/* Saturation / Lightness area */}
          <div
            className="color-picker-sl-area"
            ref={satLightRef}
            onMouseDown={handleSLMouseDown}
            style={{
              background: `linear-gradient(to right, hsl(${hue}, 0%, 50%), hsl(${hue}, 100%, 50%))`,
            }}
          >
            <div className="color-picker-sl-white" />
            <div className="color-picker-sl-black" />
            <div
              className="color-picker-sl-cursor"
              style={{
                left: `${saturation}%`,
                top: `${100 - lightness}%`,
                backgroundColor: currentHex,
              }}
            />
          </div>

          {/* Hue bar */}
          <div
            className="color-picker-hue-bar"
            ref={hueRef}
            onMouseDown={handleHueMouseDown}
          >
            <div
              className="color-picker-hue-cursor"
              style={{ left: `${(hue / 360) * 100}%` }}
            />
          </div>

          {/* Preview + hex input */}
          <div className="color-picker-preview-row">
            <div className="color-picker-swatch" style={{ backgroundColor: currentHex }} />
            <input
              className="color-picker-hex-input"
              type="text"
              value={hexInput}
              onChange={handleHexChange}
              maxLength={7}
              spellCheck={false}
            />
          </div>

          {/* Presets */}
          <div className="color-picker-presets">
            {presets.map((preset) => (
              <button
                key={preset}
                className={`color-picker-preset${preset === currentHex ? ' active' : ''}`}
                style={{ backgroundColor: preset }}
                onClick={() => {
                  const { h, s, l } = hexToHSL(preset);
                  setHue(h);
                  setSaturation(s);
                  setLightness(l);
                }}
                title={preset}
              />
            ))}
          </div>
        </div>

        <div className="color-picker-actions">
          <button className="color-picker-cancel-btn" onClick={onClose}>Close</button>
          <button className="color-picker-save-btn" onClick={() => onSave(currentHex)}>Save</button>
        </div>
      </div>
    </div>
  );
}

export default ColorPicker;
