import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './CallStage.css';

function VideoElement({ stream, mirrored }) {
  const ref = useRef(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;

    const play = () => {
      if (stream) video.play().catch(() => {});
    };

    video.srcObject = stream || null;
    video.onloadedmetadata = play;
    video.oncanplay = play;
    play();

    return () => {
      video.onloadedmetadata = null;
      video.oncanplay = null;
    };
  }, [stream]);

  return (
    <video
      ref={ref}
      className={`call-video${mirrored ? ' mirrored' : ''}`}
      autoPlay
      muted
      playsInline
    />
  );
}

function getInitial(member) {
  const name = member.displayName || member.username || member.id || '?';
  return name.charAt(0).toUpperCase();
}

function CallTile({ tile, onClick, compact = false }) {
  const hasStream = !!tile.stream;
  const isScreenBlocked = tile.source === 'screen' && tile.needsSelection;

  return (
    <button
      className={`call-tile ${compact ? 'compact' : ''} ${tile.isSpeaking ? 'speaking' : ''} ${isScreenBlocked ? 'needs-selection' : ''}`}
      onClick={onClick}
      title={tile.title}
    >
      {hasStream && !isScreenBlocked ? (
        <VideoElement stream={tile.stream} mirrored={tile.mirrored} />
      ) : (
        <div className="call-avatar-view">
          {tile.profilePicture ? (
            <img src={tile.profilePicture} alt="" />
          ) : (
            <div className="call-avatar-initial">{getInitial(tile)}</div>
          )}
          {isScreenBlocked && <div className="call-tile-action">Click to view</div>}
          {!isScreenBlocked && tile.source !== 'avatar' && <div className="call-tile-action">Connecting...</div>}
        </div>
      )}

      <div className="call-tile-footer">
        <span className="call-tile-name" style={{ color: tile.nameColor || '#e9d5ff' }}>
          {tile.displayName || tile.username || tile.id}
        </span>
        <span className="call-tile-badges">
          {tile.source === 'camera' && <span className="call-badge">CAM</span>}
          {tile.source === 'screen' && <span className="call-badge live">LIVE</span>}
          {tile.isMuted && <span className="call-badge muted">MUTE</span>}
        </span>
      </div>
    </button>
  );
}

function buildTiles(participants) {
  const tiles = [];
  participants.forEach((participant) => {
    if (participant.screenOn) {
      tiles.push({
        ...participant,
        source: 'screen',
        stream: participant.screenStream,
        needsSelection: !participant.isSelf && participant.selectedScreenUserId !== participant.id,
        title: `${participant.displayName || participant.username || 'User'} screen`,
        key: `${participant.id}:screen`,
      });
    }
    if (participant.cameraOn) {
      tiles.push({
        ...participant,
        source: 'camera',
        stream: participant.cameraStream,
        needsSelection: false,
        mirrored: participant.isSelf && participant.mirrorSelfView,
        title: `${participant.displayName || participant.username || 'User'} camera`,
        key: `${participant.id}:camera`,
      });
    }
    if (!participant.screenOn && !participant.cameraOn) {
      tiles.push({
        ...participant,
        source: 'avatar',
        stream: null,
        needsSelection: false,
        title: participant.displayName || participant.username || 'User',
        key: `${participant.id}:avatar`,
      });
    }
  });
  return tiles;
}

function sameTile(a, b) {
  return a && b && a.userId === b.id && a.source === b.source;
}

function CallStage({
  channel,
  participants,
  focusedTile,
  onFocusTile,
  onSelectScreen,
  onMinimize,
  onToggleCamera,
  onToggleScreen,
  onToggleMute,
  onToggleDeafen,
  onLeave,
  isMuted,
  isDeafened,
  cameraOn,
  screenOn,
  mediaError,
}) {
  const tiles = useMemo(() => buildTiles(participants), [participants]);
  const focused = tiles.find(tile => sameTile(focusedTile, tile)) || tiles.find(tile => tile.source !== 'avatar') || tiles[0];
  const stripTiles = focused ? tiles.filter(tile => !sameTile({ userId: focused.id, source: focused.source }, tile)) : tiles;

  const handleTileClick = (tile) => {
    if (tile.source === 'screen' && tile.needsSelection) {
      onSelectScreen(tile.id);
      onFocusTile({ userId: tile.id, source: 'screen' });
      return;
    }
    onFocusTile({ userId: tile.id, source: tile.source });
  };

  return (
    <section className="call-stage">
      <div className="call-stage-header">
        <div>
          <h2>{channel?.name || 'Voice Channel'}</h2>
          <span>{participants.length} in voice</span>
        </div>
        <button className="call-icon-btn" onClick={onMinimize} title="Minimize call">Minimize</button>
      </div>

      {mediaError && <div className="call-stage-error">{mediaError}</div>}

      {focusedTile && focused ? (
        <div className="call-focus-layout">
          <div className="call-focus-tile">
            <CallTile tile={focused} onClick={() => handleTileClick(focused)} />
          </div>
          {stripTiles.length > 0 && (
            <div className="call-strip">
              {stripTiles.map(tile => (
                <CallTile
                  key={tile.key}
                  tile={tile}
                  compact
                  onClick={() => handleTileClick(tile)}
                />
              ))}
            </div>
          )}
        </div>
      ) : tiles.length === 0 ? (
        <div className="call-grid empty">No one is in this voice channel.</div>
      ) : (
        <div className="call-grid">
          {tiles.map(tile => (
            <CallTile key={tile.key} tile={tile} onClick={() => handleTileClick(tile)} />
          ))}
        </div>
      )}

      <div className="call-stage-controls">
        <button className={`call-control ${isMuted ? 'active danger' : ''}`} onClick={onToggleMute}>
          {isMuted ? 'Unmute' : 'Mute'}
        </button>
        <button className={`call-control ${isDeafened ? 'active danger' : ''}`} onClick={onToggleDeafen}>
          {isDeafened ? 'Undeafen' : 'Deafen'}
        </button>
        <button className={`call-control ${cameraOn ? 'active' : ''}`} onClick={onToggleCamera}>
          {cameraOn ? 'Stop Camera' : 'Camera'}
        </button>
        <button className={`call-control ${screenOn ? 'active live' : ''}`} onClick={onToggleScreen}>
          {screenOn ? 'Stop Share' : 'Share Screen'}
        </button>
        <button className="call-control danger" onClick={onLeave}>Leave</button>
      </div>
    </section>
  );
}

function FloatingCallWindow({ participants, focusedTile, onRestore, onSelectScreen }) {
  const [position, setPosition] = useState({ right: 28, top: 76 });
  const windowRef = useRef(null);
  const dragRef = useRef(null);
  const suppressRestoreClickRef = useRef(false);
  const tiles = useMemo(() => buildTiles(participants), [participants]);
  const activeTile = tiles.find(tile => tile.source !== 'avatar' && (!tile.needsSelection || tile.stream)) || tiles[0];

  const clampPosition = useCallback((nextPosition) => {
    const node = windowRef.current;
    const width = node?.offsetWidth || 260;
    const height = node?.offsetHeight || 156;
    const minRight = 12;
    const minTop = 44;
    const maxRight = Math.max(minRight, window.innerWidth - width - 12);
    const maxTop = Math.max(minTop, window.innerHeight - height - 12);

    return {
      right: Math.min(maxRight, Math.max(minRight, nextPosition.right)),
      top: Math.min(maxTop, Math.max(minTop, nextPosition.top)),
    };
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setPosition(current => clampPosition(current));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [clampPosition]);

  const startDrag = (event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const start = { ...position };
    dragRef.current = { startX, startY, start, moved: false };

    const handleMove = (moveEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const deltaX = moveEvent.clientX - drag.startX;
      const deltaY = moveEvent.clientY - drag.startY;
      if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
        drag.moved = true;
      }
      setPosition(clampPosition({
        right: Math.max(12, drag.start.right - deltaX),
        top: Math.max(44, drag.start.top + deltaY),
      }));
    };

    const handleUp = () => {
      if (dragRef.current?.moved) {
        suppressRestoreClickRef.current = true;
        setTimeout(() => {
          suppressRestoreClickRef.current = false;
        }, 150);
      }
      dragRef.current = null;
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  };

  if (!activeTile) return null;

  const handleClick = () => {
    if (suppressRestoreClickRef.current) return;
    if (activeTile.source === 'screen' && activeTile.needsSelection) {
      onSelectScreen(activeTile.id);
    }
    onRestore(focusedTile || { userId: activeTile.id, source: activeTile.source });
  };

  return (
    <div
      ref={windowRef}
      className="floating-call-window"
      style={{ right: position.right, top: position.top }}
      onMouseDown={startDrag}
      onDoubleClick={handleClick}
    >
      <div className="floating-call-preview">
        <CallTile tile={activeTile} compact onClick={handleClick} />
      </div>
    </div>
  );
}

export { FloatingCallWindow };
export default CallStage;
