import React, { useState, useEffect, useRef } from 'react';
import { gifAPI } from '../api';
import Twemoji from './Twemoji';
import './GifPicker.css';

const GifPicker = ({ onGifSelect, onClose, accountKey }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('trending'); // 'trending', 'favorites', 'categories'
  const [gifs, setGifs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [favorites, setFavorites] = useState([]);
  const [categories, setCategories] = useState([]);
  const [, setSelectedCategory] = useState(null);
  const containerRef = useRef(null);

  // Load favorites from localStorage
  useEffect(() => {
    const savedFavorites = localStorage.getItem(`gifFavorites_${accountKey}`);
    if (savedFavorites) {
      try {
        setFavorites(JSON.parse(savedFavorites));
      } catch (e) {
        console.error('Failed to load favorites:', e);
      }
    }
  }, []);

  // Load initial data
  useEffect(() => {
    loadTrendingGifs();
    loadCategories();
  }, []);

  // Close picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      // Don't close if clicking on the GIF button itself
      if (event.target.closest('.gif-btn')) {
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

  // Load trending GIFs
  const loadTrendingGifs = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await gifAPI.getTrendingGifs(24, 1);
      // Handle Klipy response structure: { result: true, data: { data: [...], ... } }
      const gifData = response.data.data?.data || response.data.data || [];
      setGifs(gifData);
    } catch (err) {
      if (err.response?.status === 503) {
        setError('GIF service is not configured for this server');
      } else {
        setError('Failed to load GIFs');
      }
      console.error('Error loading GIFs:', err);
    }
    setLoading(false);
  };

  // Search for GIFs
  const handleSearch = async (e) => {
    const query = e.target.value;
    setSearchQuery(query);

    if (!query.trim()) {
      setActiveTab('trending');
      loadTrendingGifs();
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await gifAPI.searchGifs(query, 24, 1);
      const gifData = response.data.data?.data || response.data.data || [];
      setGifs(gifData);
      setActiveTab('search');
    } catch (err) {
      setError('Failed to search GIFs');
      console.error('Error searching GIFs:', err);
    }
    setLoading(false);
  };

  // Load categories
  const loadCategories = async () => {
    try {
      const response = await gifAPI.getCategories();
      // Handle Klipy response structure: { result: true, data: { categories: [...] } }
      const categoryData = response.data.data?.categories || response.data.categories || [];
      setCategories(categoryData);
    } catch (err) {
      console.error('Error loading categories:', err);
    }
  };

  // Load category GIFs
  const handleCategoryClick = async (categoryQuery) => {
    setSelectedCategory(categoryQuery);
    setLoading(true);
    setError(null);
    try {
      const response = await gifAPI.searchGifs(categoryQuery, 24, 1);
      const gifData = response.data.data?.data || response.data.data || [];
      setGifs(gifData);
      setActiveTab('category');
    } catch (err) {
      setError('Failed to load category GIFs');
      console.error('Error loading category GIFs:', err);
    }
    setLoading(false);
  };

  // Toggle favorite
  const toggleFavorite = (gif) => {
    setFavorites((prev) => {
      const isFavorite = prev.some((f) => f.id === gif.id);
      let updated;
      if (isFavorite) {
        updated = prev.filter((f) => f.id !== gif.id);
      } else {
        updated = [gif, ...prev];
      }
      localStorage.setItem(`gifFavorites_${accountKey}`, JSON.stringify(updated));
      return updated;
    });
  };

  // Check if a GIF is favorite
  const isFavorite = (gifId) => {
    return favorites.some((f) => f.id === gifId);
  };

  // Handle GIF selection
  const handleGifClick = (gif) => {
    // Klipy response structure: file.md.gif.url or file.hd.gif.url
    const gifUrl = gif.file?.md?.gif?.url || gif.file?.hd?.gif?.url || gif.url;
    if (gifUrl) {
      onGifSelect(gifUrl);
      onClose();
    }
  };

  const displayGifs = activeTab === 'favorites' ? favorites : gifs;

  return (
    <div ref={containerRef} className="gif-picker-dropdown">
      <div className="gif-picker-container">
        {/* Search bar */}
        <div className="gif-search-bar">
          <input
            type="text"
            placeholder="Search KLIPY"
            value={searchQuery}
            onChange={handleSearch}
            autoFocus
          />
        </div>

        {/* Tabs */}
        <div className="gif-tabs">
          <button
            className={`gif-tab ${activeTab === 'trending' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('trending');
              setSearchQuery('');
              loadTrendingGifs();
            }}
          >
            Trending
          </button>
          <button
            className={`gif-tab ${activeTab === 'favorites' ? 'active' : ''}`}
            onClick={() => setActiveTab('favorites')}
          >
            <Twemoji emoji="⭐" size={14} /> Favorites ({favorites.length})
          </button>
          <button
            className={`gif-tab ${activeTab === 'categories' ? 'active' : ''}`}
            onClick={() => setActiveTab('categories')}
          >
            Categories
          </button>
        </div>

        {/* Content */}
        <div className="gif-picker-content">
          {activeTab === 'categories' && categories.length > 0 ? (
            <div className="gif-categories-grid">
              {categories.map((category) => (
                <button
                  key={category.category}
                  className="gif-category-item"
                  onClick={() => handleCategoryClick(category.query)}
                  style={{
                    backgroundImage: `url(${category.preview_url})`,
                  }}
                >
                  <div className="gif-category-label">{category.category}</div>
                </button>
              ))}
            </div>
          ) : activeTab === 'favorites' && favorites.length === 0 ? (
            <div className="gif-empty-state">
              <p>No favorite GIFs yet</p>
            </div>
          ) : error ? (
            <div className="gif-error">
              <p>{error}</p>
            </div>
          ) : loading ? (
            <div className="gif-loading">Loading GIFs...</div>
          ) : displayGifs.length === 0 ? (
            <div className="gif-empty-state">
              <p>No GIFs found</p>
            </div>
          ) : (
            <div className="gif-grid">
              {displayGifs.map((gif) => {
                // Klipy response structure
                const gifUrl = gif.file?.md?.gif?.url || gif.file?.hd?.gif?.url || gif.url;
                const gifId = gif.id || gif.slug;
                const gifTitle = gif.title || 'GIF';
                return (
                  <div key={gifId} className="gif-item">
                    <button
                      className="gif-image-button"
                      onClick={() => handleGifClick(gif)}
                    >
                      <img
                        src={gifUrl}
                        alt={gifTitle}
                        loading="lazy"
                      />
                    </button>
                    <button
                      className={`gif-favorite-btn ${isFavorite(gif.id) ? 'favorited' : ''}`}
                      onClick={() => toggleFavorite(gif)}
                      title={isFavorite(gif.id) ? 'Remove from favorites' : 'Add to favorites'}
                    >
                      <Twemoji emoji="⭐" size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default GifPicker;
