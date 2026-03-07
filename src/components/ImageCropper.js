import React, { useState, useRef, useEffect } from 'react';
import './ImageCropper.css';

function ImageCropper({ imageData, onCropComplete, onCancel }) {
  const canvasRef = useRef(null);
  const [image, setImage] = useState(null);
  // offset represents the source pixel position (top-left corner of what's visible in circle)
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, offsetX: 0, offsetY: 0 });
  const [zoom, setZoom] = useState(1);

  const CIRCLE_SIZE = 300;

  // Calculate minimum zoom to ensure image always covers the circle
  const getMinimumZoom = () => {
    if (!image) return 1;
    const minZoomWidth = CIRCLE_SIZE / image.width;
    const minZoomHeight = CIRCLE_SIZE / image.height;
    return Math.ceil(Math.max(minZoomWidth, minZoomHeight) * 10) / 10; // Round up to nearest 0.1
  };

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setImage(img);
      
      // Set zoom to minimum required to fill circle
      const minZoom = Math.ceil(Math.max(CIRCLE_SIZE / img.width, CIRCLE_SIZE / img.height) * 10) / 10;
      setZoom(minZoom);
      
      // Center the image: calculate source pixel where the center of image aligns with center of circle
      const scaledWidth = img.width * minZoom;
      const scaledHeight = img.height * minZoom;
      
      // How much of the image extends beyond circle on each side
      const extraWidth = scaledWidth - CIRCLE_SIZE;
      const extraHeight = scaledHeight - CIRCLE_SIZE;
      
      // Center point: leave half the extra width/height on the left/top
      const centerSourceX = Math.max(0, extraWidth / 2 / minZoom);
      const centerSourceY = Math.max(0, extraHeight / 2 / minZoom);
      
      setOffset({
        x: Math.round(centerSourceX),
        y: Math.round(centerSourceY)
      });
    };
    img.src = imageData;
  }, [imageData]);

  const handleMouseDown = (e) => {
    setIsDragging(true);
    setDragStart({
      x: e.clientX,
      y: e.clientY,
      offsetX: offset.x,
      offsetY: offset.y
    });
  };

  const handleMouseMove = (e) => {
    if (!isDragging || !image) return;

    const deltaX = e.clientX - dragStart.x;
    const deltaY = e.clientY - dragStart.y;

    // Convert pixel movement to source image movement (accounting for zoom)
    const sourceMovementX = deltaX / zoom;
    const sourceMovementY = deltaY / zoom;

    // Calculate new offset (source pixel position)
    const newX = dragStart.offsetX - sourceMovementX;
    const newY = dragStart.offsetY - sourceMovementY;

    // Bounds: ensure circle stays within image
    // Can't show pixels before 0
    const minOffsetX = 0;
    const minOffsetY = 0;
    // Can't show past the end of the image
    const maxOffsetX = Math.max(0, image.width - CIRCLE_SIZE / zoom);
    const maxOffsetY = Math.max(0, image.height - CIRCLE_SIZE / zoom);

    setOffset({
      x: Math.max(minOffsetX, Math.min(maxOffsetX, newX)),
      y: Math.max(minOffsetY, Math.min(maxOffsetY, newY))
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleZoom = (direction) => {
    const minZoom = getMinimumZoom();
    const newZoom = direction === 'in' ? Math.min(zoom + 0.1, 3) : Math.max(zoom - 0.1, minZoom);
    
    // When zooming, keep the center of the circle showing the same point in the image
    if (image) {
      // Current center of the circle in source image coordinates
      const centerSourceX = offset.x + CIRCLE_SIZE / (2 * zoom);
      const centerSourceY = offset.y + CIRCLE_SIZE / (2 * zoom);
      
      // Calculate new offset to keep same center in view
      const newOffsetX = centerSourceX - CIRCLE_SIZE / (2 * newZoom);
      const newOffsetY = centerSourceY - CIRCLE_SIZE / (2 * newZoom);
      
      // Apply bounds
      const minOffsetX = 0;
      const minOffsetY = 0;
      const maxOffsetX = Math.max(0, image.width -CIRCLE_SIZE / newZoom);
      const maxOffsetY = Math.max(0, image.height - CIRCLE_SIZE / newZoom);
      
      setOffset({
        x: Math.max(minOffsetX, Math.min(maxOffsetX, newOffsetX)),
        y: Math.max(minOffsetY, Math.min(maxOffsetY, newOffsetY))
      });
    }
    
    setZoom(newZoom);
  };

  const generateCroppedImage = () => {
    if (!image) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    // Clear canvas with white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, CIRCLE_SIZE, CIRCLE_SIZE);

    // Draw circular mask
    ctx.beginPath();
    ctx.arc(CIRCLE_SIZE / 2, CIRCLE_SIZE / 2, CIRCLE_SIZE / 2, 0, Math.PI * 2);
    ctx.clip();

    // Draw the image from source offset with zoom scaling
    // offset is in source image coordinates
    const sourceWidth = CIRCLE_SIZE / zoom;
    const sourceHeight = CIRCLE_SIZE / zoom;
    
    ctx.drawImage(
      image,
      offset.x,
      offset.y,
      sourceWidth,
      sourceHeight,
      0,
      0,
      CIRCLE_SIZE,
      CIRCLE_SIZE
    );

    return canvas.toDataURL('image/png');
  };

  const handleConfirm = () => {
    const croppedImage = generateCroppedImage();
    onCropComplete(croppedImage);
  };

  useEffect(() => {
    const handleMouseMoveGlobal = (e) => handleMouseMove(e);
    const handleMouseUpGlobal = () => handleMouseUp();

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMoveGlobal);
      document.addEventListener('mouseup', handleMouseUpGlobal);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMoveGlobal);
      document.removeEventListener('mouseup', handleMouseUpGlobal);
    };
  }, [isDragging, dragStart, offset, image, zoom]);

  return (
    <div className="image-cropper-backdrop" onClick={onCancel}>
      <div className="image-cropper-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cropper-header">
          <h3>Position Your Avatar</h3>
          <button
            className="cropper-close-btn"
            onClick={onCancel}
            title="Close"
          >
            ×
          </button>
        </div>

        <div className="cropper-container">
          <div
            className="cropper-circle"
            onMouseDown={handleMouseDown}
            style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
          >
            <canvas
              ref={canvasRef}
              width={CIRCLE_SIZE}
              height={CIRCLE_SIZE}
              style={{ width: '100%', height: '100%' }}
            />
            <div
              className="cropper-image-preview"
              onMouseDown={handleMouseDown}
              style={{
                backgroundImage: `url(${imageData})`,
                backgroundPosition: `${-offset.x * zoom}px ${-offset.y * zoom}px`,
                backgroundSize: `${image?.width ? image.width * zoom : 0}px ${image?.height ? image.height * zoom : 0}px`,
                backgroundRepeat: 'no-repeat'
              }}
            />
          </div>

          <div className="cropper-controls">
            <button
              className="zoom-btn"
              onClick={() => handleZoom('out')}
              disabled={zoom <= 0.5}
              title="Zoom Out"
            >
              −
            </button>
            <span className="zoom-level">{Math.round(zoom * 100)}%</span>
            <button
              className="zoom-btn"
              onClick={() => handleZoom('in')}
              disabled={zoom >= 3}
              title="Zoom In"
            >
              +
            </button>
          </div>
        </div>

        <div className="cropper-info">
          <p>Drag the image to position it. Use zoom controls to adjust the size.</p>
        </div>

        <div className="cropper-actions">
          <button onClick={onCancel} className="cropper-cancel-btn">
            Cancel
          </button>
          <button onClick={handleConfirm} className="cropper-confirm-btn">
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

export default ImageCropper;
