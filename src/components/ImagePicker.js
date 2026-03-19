import React, { useState, useEffect, useRef } from 'react';
import CustomModal from './CustomModal';
import Twemoji from './Twemoji';
import './ImagePicker.css';

const ImagePicker = ({ onImageSelect, onClose, accountKey }) => {
  const [activeTab, setActiveTab] = useState('images'); // 'images', 'favorites', 'upload'
  const [images, setImages] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const containerRef = useRef(null);
  const fileInputRef = useRef(null);
  const MAX_IMAGES = 50;
  const [modalInfo, setModalInfo] = useState({ open: false, message: '' });

  const showModal = (message, { title = '' } = {}) => {
    setModalInfo({ open: true, title, message });
  };
  const closeModal = () => {
    setModalInfo(prev => ({ ...prev, open: false }));
  };

  // Load images and favorites from localStorage
  useEffect(() => {
    const savedImages = localStorage.getItem(`uploadedImages_${accountKey}`);
    const savedFavorites = localStorage.getItem(`favoriteImages_${accountKey}`);
    
    if (savedImages) {
      try {
        setImages(JSON.parse(savedImages));
      } catch (e) {
        console.error('Failed to load images:', e);
      }
    }
    
    if (savedFavorites) {
      try {
        setFavorites(JSON.parse(savedFavorites));
      } catch (e) {
        console.error('Failed to load favorites:', e);
      }
    }
  }, []);

  // Close picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      // Don't close if clicking on the image button itself
      if (event.target.closest('.image-btn')) {
        return;
      }
      
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  const handleImageUpload = (e) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach(file => {
      if (images.length >= MAX_IMAGES) {
        showModal(`Maximum ${MAX_IMAGES} images allowed`, { title: 'Limit Reached' });
        return;
      }

      if (!file.type.startsWith('image/')) {
        showModal('Please select an image file', { title: 'Invalid File' });
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        const newImage = {
          id: Date.now() + Math.random(),
          data: event.target.result,
          uploadedAt: new Date().toLocaleString()
        };
        
        const updatedImages = [...images, newImage];
        setImages(updatedImages);
        localStorage.setItem(`uploadedImages_${accountKey}`, JSON.stringify(updatedImages));
      };
      reader.readAsDataURL(file);
    });

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDeleteImage = (imageId) => {
    const updatedImages = images.filter(img => img.id !== imageId);
    setImages(updatedImages);
    localStorage.setItem(`uploadedImages_${accountKey}`, JSON.stringify(updatedImages));
    
    // Also remove from favorites if present
    if (favorites.includes(imageId)) {
      const updatedFavorites = favorites.filter(fav => fav !== imageId);
      setFavorites(updatedFavorites);
      localStorage.setItem(`favoriteImages_${accountKey}`, JSON.stringify(updatedFavorites));
    }
  };

  const handleToggleFavorite = (imageId) => {
    let updatedFavorites;
    if (favorites.includes(imageId)) {
      updatedFavorites = favorites.filter(fav => fav !== imageId);
    } else {
      updatedFavorites = [...favorites, imageId];
    }
    setFavorites(updatedFavorites);
    localStorage.setItem(`favoriteImages_${accountKey}`, JSON.stringify(updatedFavorites));
  };

  const handleSelectImage = (imageData) => {
    onImageSelect(imageData);
  };

  const getDisplayImages = () => {
    if (activeTab === 'images') {
      return images;
    } else if (activeTab === 'favorites') {
      return images.filter(img => favorites.includes(img.id));
    }
    return [];
  };

  const displayImages = getDisplayImages();

  return (
    <div 
      ref={containerRef}
      className="image-picker-dropdown"
    >
      <div className="image-picker-container">
        <div className="image-tabs">
          <button 
            className={`image-tab ${activeTab === 'images' ? 'active' : ''}`}
            onClick={() => setActiveTab('images')}
          >
            Images ({images.length}/{MAX_IMAGES})
          </button>
          <button 
            className={`image-tab ${activeTab === 'favorites' ? 'active' : ''}`}
            onClick={() => setActiveTab('favorites')}
          >
            Favorites ({favorites.length})
          </button>
          <button 
            className={`image-tab ${activeTab === 'upload' ? 'active' : ''}`}
            onClick={() => setActiveTab('upload')}
          >
            Upload
          </button>
        </div>

        {activeTab === 'images' && (
          <div className="image-picker-content">
            {images.length === 0 ? (
              <div className="image-empty-state">No images uploaded yet</div>
            ) : (
              <div className="image-grid">
                {displayImages.map(image => (
                  <div
                    key={image.id}
                    className="image-item"
                    onClick={() => handleSelectImage(image.data)}
                    style={{ cursor: 'pointer' }}
                  >
                    <img src={image.data} alt="uploaded" />
                    <button
                      className="image-favorite-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleFavorite(image.id);
                      }}
                      title={favorites.includes(image.id) ? 'Remove from favorites' : 'Add to favorites'}
                    >
                      {favorites.includes(image.id) ? <Twemoji emoji="⭐" size={14} /> : '☆'}
                    </button>
                    <button
                      className="image-delete-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteImage(image.id);
                      }}
                      title="Delete image"
                    >
                      <Twemoji emoji="🗑️" size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'favorites' && (
          <div className="image-picker-content">
            {displayImages.length === 0 ? (
              <div className="image-empty-state">No favorite images</div>
            ) : (
              <div className="image-grid">
                {displayImages.map(image => (
                  <div
                    key={image.id}
                    className="image-item"
                    onClick={() => handleSelectImage(image.data)}
                    style={{ cursor: 'pointer' }}
                  >
                    <img src={image.data} alt="favorite" />
                    <button
                      className="image-favorite-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleFavorite(image.id);
                      }}
                      title="Remove from favorites"
                    >
                      <Twemoji emoji="⭐" size={14} />
                    </button>
                    <button
                      className="image-delete-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteImage(image.id);
                      }}
                      title="Delete image"
                    >
                      <Twemoji emoji="🗑️" size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'upload' && (
          <div className="image-picker-content image-upload-area">
            {images.length >= MAX_IMAGES ? (
              <div className="image-empty-state">
                Maximum {MAX_IMAGES} images reached. Delete some to upload more.
              </div>
            ) : (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*"
                  onChange={handleImageUpload}
                  style={{ display: 'none' }}
                />
                <button
                  className="upload-button"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Twemoji emoji="📁" size={14} /> Choose Images
                </button>
                <div className="upload-info">
                  Select one or more images to upload
                  <br />
                  ({images.length}/{MAX_IMAGES} images used)
                </div>
              </>
            )}
          </div>
        )}
      </div>
      <CustomModal
        isOpen={modalInfo.open}
        title={modalInfo.title}
        message={modalInfo.message}
        type="alert"
        onConfirm={closeModal}
        onCancel={closeModal}
      />
    </div>
  );
};

export default ImagePicker;
