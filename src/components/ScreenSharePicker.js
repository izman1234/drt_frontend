import React, { useEffect, useState } from 'react';
import './ScreenSharePicker.css';

function ScreenSharePicker({ isOpen, onSelect, onCancel }) {
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    const loadSources = async () => {
      setLoading(true);
      setError('');
      try {
        if (!window.electron?.getDesktopSources) {
          setSources([]);
          return;
        }
        const result = await window.electron.getDesktopSources({ types: ['screen', 'window'] });
        if (cancelled) return;
        if (result?.success) {
          setSources(result.sources || []);
        } else {
          setError(result?.error || 'Unable to load screen sources.');
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadSources();
    return () => { cancelled = true; };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="screen-picker-backdrop" onMouseDown={onCancel}>
      <div className="screen-picker" onMouseDown={(e) => e.stopPropagation()}>
        <div className="screen-picker-header">
          <h3>Share Screen</h3>
          <button className="screen-picker-close" onClick={onCancel} title="Close">x</button>
        </div>

        {loading && <div className="screen-picker-status">Loading sources...</div>}
        {error && <div className="screen-picker-error">{error}</div>}

        {!loading && sources.length === 0 && (
          <div className="screen-picker-empty">
            <p>Use your system picker to choose a screen or window.</p>
            <button className="screen-picker-system-btn" onClick={() => onSelect(null)}>
              Open System Picker
            </button>
          </div>
        )}

        {sources.length > 0 && (
          <div className="screen-source-grid">
            {sources.map(source => (
              <button
                key={source.id}
                className="screen-source-card"
                onClick={() => onSelect(source)}
                title={source.name}
              >
                <div className="screen-source-thumb">
                  {source.thumbnail ? (
                    <img src={source.thumbnail} alt="" />
                  ) : (
                    <div className="screen-source-placeholder">No Preview</div>
                  )}
                </div>
                <div className="screen-source-name">{source.name}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default ScreenSharePicker;
