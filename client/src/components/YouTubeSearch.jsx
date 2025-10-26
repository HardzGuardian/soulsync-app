import React, { useState, useRef } from 'react';
import { youtubeAPI } from '../services/api.js';

function YouTubeSearch({ onAddToPlaylist, isOpen, onClose }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const searchTimeoutRef = useRef(null);

  const searchYouTube = async (query) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const videos = await youtubeAPI.search(query);
      setSearchResults(videos);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearchChange = (e) => {
    const query = e.target.value;
    setSearchQuery(query);
    
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    
    searchTimeoutRef.current = setTimeout(() => {
      searchYouTube(query);
    }, 500);
  };

  const handleAddVideo = (video) => {
    onAddToPlaylist({
      videoId: video.videoId,
      title: video.title,
      thumbnail: video.thumbnail,
      channelTitle: video.channelTitle
    });
    setSearchQuery('');
    setSearchResults([]);
    onClose();
  };

  const handleClose = (e) => {
    if (e.target === e.currentTarget) {
      setSearchQuery('');
      setSearchResults([]);
      setError('');
      onClose();
    }
  };

  const clearSearch = () => {
    setSearchQuery('');
    setSearchResults([]);
    setError('');
  };

  if (!isOpen) return null;

  return (
    <div 
      className="modal-overlay"
      onClick={handleClose}
    >
      <div 
        className="search-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '10px', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
            <span>🔍</span>
            Search YouTube
          </h2>
          <button 
            onClick={handleClose}
            className="close-button"
          >
            ×
          </button>
        </div>

        <div style={{ position: 'relative', marginBottom: '20px' }}>
          <input
            type="text"
            placeholder="Search for videos, music, podcasts..."
            value={searchQuery}
            onChange={handleSearchChange}
            className="search-input"
            autoFocus
          />
          {searchQuery && (
            <button
              onClick={clearSearch}
              style={{
                position: 'absolute',
                right: '40px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                color: '#666',
                cursor: 'pointer',
                fontSize: '18px'
              }}
            >
              ×
            </button>
          )}
          {isLoading && (
            <div className="search-loading">
              <div className="loading-spinner"></div>
              Searching...
            </div>
          )}
        </div>

        {error && (
          <div className="error-message">
            <strong>Error:</strong> {error}
          </div>
        )}

        <div className="search-results-container">
          {searchResults.length > 0 ? (
            <div className="search-results-list">
              {searchResults.map((video) => (
                <div
                  key={video.videoId}
                  className="search-result-item"
                  onClick={() => handleAddVideo(video)}
                >
                  <div className="video-thumbnail">
                    <img
                      src={video.thumbnail}
                      alt={video.title}
                      onError={(e) => {
                        e.target.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTQwIiBoZWlnaHQ9IjEwNSIgdmlld0JveD0iMCAwIDE0MCAxMDUiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIxNDAiIGhlaWdodD0iMTA1IiBmaWxsPSIjMzMzIi8+Cjx0ZXh0IHg9IjcwIiB5PSI1Mi41IiBmb250LWZhbWlseT0iQXJpYWwsIHNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IiM2NjYiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIj5ObyBJbWFnZTwvdGV4dD4KPC9zdmc+Cg==';
                      }}
                    />
                  </div>
                  <div className="video-info">
                    <div className="video-title" title={video.title}>
                      {video.title}
                    </div>
                    <div className="video-channel">
                      {video.channelTitle}
                    </div>
                    <div className="video-description">
                      {video.description?.substring(0, 100)}...
                    </div>
                  </div>
                  <button
                    className="add-button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleAddVideo(video);
                    }}
                  >
                    Add to Queue
                  </button>
                </div>
              ))}
            </div>
          ) : searchQuery && !isLoading && !error ? (
            <div className="no-results">
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔍</div>
              <h3>No videos found</h3>
              <p>Try different keywords or check your spelling</p>
            </div>
          ) : !searchQuery && !error ? (
            <div className="search-placeholder">
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎵</div>
              <h3>Search YouTube</h3>
              <p>Enter keywords to find videos for your playlist</p>
              <div style={{ marginTop: '20px', fontSize: '14px', color: '#666' }}>
                <div>Try searching for: <em>"lofi study beats"</em>, <em>"80s rock"</em>, <em>"podcast"</em></div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="search-footer">
          <div style={{ fontSize: '12px', color: '#a1a1aa' }}>
            Powered by YouTube Data API • SoulSync
          </div>
        </div>
      </div>
    </div>
  );
}

export default YouTubeSearch;