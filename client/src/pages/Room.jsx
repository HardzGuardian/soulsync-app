import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import io from 'socket.io-client';
import YouTubeSearch from '../components/YouTubeSearch';
import { youtubeAPI } from '../services/api.js';

function Room() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const userName = location.state?.userName;
  
  const [socket, setSocket] = useState(null);
  const [playlist, setPlaylist] = useState([]);
  const [currentVideo, setCurrentVideo] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [users, setUsers] = useState([]);
  const [videoUrl, setVideoUrl] = useState('');
  const [syncStatus, setSyncStatus] = useState('Synced');
  const [showSearch, setShowSearch] = useState(false);
  // Chat state
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [showChat, setShowChat] = useState(true);
  // Background playback state
  const [backgroundPlayback, setBackgroundPlayback] = useState(true);
  const [playerVisible, setPlayerVisible] = useState(true);
  const [miniPlayer, setMiniPlayer] = useState(false);
  
  const playerRef = useRef(null);
  const syncIntervalRef = useRef(null);
  const chatContainerRef = useRef(null);
  const lastSyncRef = useRef(Date.now());

  // Setup service worker for background playback
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then(() => {
        console.log('Service Worker registered');
      }).catch(console.error);
    }
  }, []);

  // Handle app visibility changes
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && backgroundPlayback && isPlaying) {
        console.log('App in background, maintaining playback');
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [backgroundPlayback, isPlaying]);

  // Enhanced socket connection with background features
  useEffect(() => {
    if (!userName) {
      navigate('/');
      return;
    }

    const socketUrl = import.meta.env.MODE === 'development' 
      ? 'http://localhost:3001' 
      : '';

    const newSocket = io(socketUrl);
    setSocket(newSocket);

    newSocket.emit('join-room', { roomId, userName });

    // Enhanced event listeners
    newSocket.on('room-state', (state) => {
      setPlaylist(state.playlist || []);
      setCurrentVideo(state.currentVideo);
      setIsPlaying(state.isPlaying || false);
      setMessages(state.messages || []);
      setBackgroundPlayback(state.backgroundPlayback !== false);
    });

    newSocket.on('playlist-updated', setPlaylist);
    
    newSocket.on('video-changed', ({ video, isPlaying: playing }) => {
      setCurrentVideo(video);
      setIsPlaying(playing);
      if (playing && playerRef.current) {
        playerRef.current.playVideo();
      }
    });

    newSocket.on('video-played', () => {
      setIsPlaying(true);
      if (playerRef.current) {
        playerRef.current.playVideo();
      }
    });

    newSocket.on('video-paused', () => {
      setIsPlaying(false);
      if (playerRef.current) {
        playerRef.current.pauseVideo();
      }
    });

    newSocket.on('video-seeked', ({ time }) => {
      if (playerRef.current) {
        playerRef.current.seekTo(time, true);
      }
    });

    // Auto-sync event
    newSocket.on('auto-sync', ({ time, isPlaying: serverPlaying, videoId }) => {
      if (playerRef.current && currentVideo?.videoId === videoId) {
        const currentTime = playerRef.current.getCurrentTime();
        const timeDiff = Math.abs(currentTime - time);
        
        if (timeDiff > 1 && Date.now() - lastSyncRef.current > 2000) {
          playerRef.current.seekTo(time, true);
          setSyncStatus('Auto-synced');
          lastSyncRef.current = Date.now();
          setTimeout(() => setSyncStatus('Synced'), 2000);
        }
        
        if (serverPlaying !== isPlaying) {
          if (serverPlaying) {
            playerRef.current.playVideo();
          } else {
            playerRef.current.pauseVideo();
          }
          setIsPlaying(serverPlaying);
        }
      }
    });

    // Sync response for manual sync
    newSocket.on('sync-response', ({ time, isPlaying: serverPlaying }) => {
      if (playerRef.current) {
        playerRef.current.seekTo(time, true);
        if (serverPlaying !== isPlaying) {
          if (serverPlaying) {
            playerRef.current.playVideo();
          } else {
            playerRef.current.pauseVideo();
          }
        }
        setIsPlaying(serverPlaying);
        setSyncStatus('Manually synced');
        setTimeout(() => setSyncStatus('Synced'), 2000);
      }
    });

    // Background playback events
    newSocket.on('background-playback-toggled', ({ enabled, updatedBy }) => {
      setBackgroundPlayback(enabled);
      // Add system message
      const systemMessage = {
        id: Date.now().toString(),
        userName: 'System',
        message: `${updatedBy} ${enabled ? 'enabled' : 'disabled'} background playback`,
        timestamp: new Date(),
        type: 'system'
      };
      setMessages(prev => [...prev, systemMessage]);
    });

    newSocket.on('player-visibility-changed', ({ visible, userName }) => {
      if (userName !== userName) {
        console.log(`${userName} ${visible ? 'showed' : 'hid'} the player`);
      }
    });

    // Chat events
    newSocket.on('new-message', (message) => {
      setMessages(prev => [...prev, message]);
    });

    newSocket.on('user-joined', ({ userName, userCount }) => {
      console.log(`${userName} joined the room`);
    });

    newSocket.on('user-left', ({ userName, userCount }) => {
      console.log(`${userName} left the room`);
    });

    newSocket.on('error', (error) => {
      alert(error.message);
      navigate('/');
    });

    // Request sync every 10 seconds
    syncIntervalRef.current = setInterval(() => {
      if (socket && currentVideo) {
        socket.emit('request-sync');
      }
    }, 10000);

    return () => {
      newSocket.close();
      clearInterval(syncIntervalRef.current);
    };
  }, [roomId, userName, navigate, currentVideo]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  // YouTube Player initialization
  useEffect(() => {
    if (!window.YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

      window.onYouTubeIframeAPIReady = initializePlayer;
    } else {
      initializePlayer();
    }

    return () => {
      if (playerRef.current) {
        playerRef.current.destroy();
      }
    };
  }, [currentVideo, playerVisible, miniPlayer]);

  const initializePlayer = () => {
    if (!currentVideo || !playerVisible) return;

    playerRef.current = new window.YT.Player('youtube-player', {
      height: miniPlayer ? '120' : '400',
      width: miniPlayer ? '213' : '100%',
      videoId: currentVideo.videoId,
      playerVars: {
        playsinline: 1,
        enablejsapi: 1,
        origin: window.location.origin,
        autoplay: isPlaying ? 1 : 0,
        controls: 1
      },
      events: {
        onReady: onPlayerReady,
        onStateChange: onPlayerStateChange
      }
    });
  };

  const onPlayerReady = (event) => {
    if (isPlaying) {
      event.target.playVideo();
    }
    
    // Request initial sync
    if (socket) {
      socket.emit('request-sync');
    }
  };

  const onPlayerStateChange = (event) => {
    if (event.data === window.YT.PlayerState.ENDED) {
      socket.emit('next-video');
    } else if (event.data === window.YT.PlayerState.PLAYING) {
      setIsPlaying(true);
    } else if (event.data === window.YT.PlayerState.PAUSED) {
      setIsPlaying(false);
    }
  };

  // Background playback controls
  const toggleBackgroundPlayback = () => {
    const newState = !backgroundPlayback;
    setBackgroundPlayback(newState);
    
    if (socket) {
      socket.emit('toggle-background-playback', { enabled: newState });
    }
  };

  const togglePlayerVisibility = () => {
    const newVisibility = !playerVisible;
    setPlayerVisible(newVisibility);
    
    if (socket) {
      socket.emit('toggle-player-visibility', { visible: newVisibility });
    }

    // Reinitialize player when showing
    if (newVisibility) {
      setTimeout(() => {
        if (currentVideo) {
          initializePlayer();
        }
      }, 100);
    }
  };

  const toggleMiniPlayer = () => {
    const newMiniState = !miniPlayer;
    setMiniPlayer(newMiniState);
    
    // Reinitialize player with new size
    setTimeout(() => {
      if (playerRef.current && currentVideo && playerVisible) {
        playerRef.current.destroy();
        initializePlayer();
      }
    }, 100);
  };

  const extractVideoId = (url) => {
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
    const match = url.match(regex);
    return match ? match[1] : null;
  };

  const addToPlaylist = async (e) => {
    e.preventDefault();
    if (!videoUrl.trim() || !socket) return;

    const videoId = extractVideoId(videoUrl);
    if (!videoId) {
      alert('Please enter a valid YouTube URL');
      return;
    }

    try {
      const videoInfo = await youtubeAPI.getVideoInfo(videoId);
      socket.emit('add-to-playlist', {
        videoId: videoInfo.videoId,
        title: videoInfo.title,
        thumbnail: videoInfo.thumbnail,
        channelTitle: videoInfo.channelTitle
      });
    } catch (error) {
      socket.emit('add-to-playlist', {
        videoId,
        title: `YouTube Video (${videoId})`,
        thumbnail: `https://i.ytimg.com/vi/${videoId}/default.jpg`,
        channelTitle: 'YouTube'
      });
    }

    setVideoUrl('');
  };

  const handleAddFromSearch = (videoData) => {
    if (!socket) return;

    socket.emit('add-to-playlist', {
      videoId: videoData.videoId,
      title: videoData.title,
      thumbnail: videoData.thumbnail,
      channelTitle: videoData.channelTitle
    });
  };

  const handlePlay = () => {
    if (socket && playerRef.current) {
      socket.emit('play-video');
      playerRef.current.playVideo();
    }
  };

  const handlePause = () => {
    if (socket && playerRef.current) {
      socket.emit('pause-video');
      playerRef.current.pauseVideo();
    }
  };

  const handleNext = () => {
    if (socket) {
      socket.emit('next-video');
    }
  };

  const handleSyncRequest = () => {
    if (socket) {
      socket.emit('request-sync');
      setSyncStatus('Syncing...');
    }
  };

  const sendMessage = (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !socket) return;

    socket.emit('send-message', { message: newMessage.trim() });
    setNewMessage('');
  };

  const copyInviteLink = () => {
    const inviteLink = `${window.location.origin}?room=${roomId}`;
    navigator.clipboard.writeText(inviteLink);
    alert('Invite link copied to clipboard! Share it with your friends!');
  };

  if (!userName) {
    return <div>Loading...</div>;
  }

  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h1 style={{ 
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            margin: 0
          }}>
            SoulSync Room
          </h1>
          <p style={{ color: '#a1a1aa', margin: 0 }}>
            Welcome, {userName}! 
            <span className="sync-status">{syncStatus}</span>
            {!playerVisible && (
              <span style={{ color: '#f59e0b', marginLeft: '10px', fontSize: '12px' }}>
                🔊 Player Hidden
              </span>
            )}
            {miniPlayer && (
              <span style={{ color: '#10b981', marginLeft: '10px', fontSize: '12px' }}>
                📱 Mini Player
              </span>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button 
            className="btn" 
            onClick={() => setShowSearch(true)}
          >
            🔍 Search YouTube
          </button>
          <button className="btn btn-secondary" onClick={handleSyncRequest}>
            🔄 Manual Sync
          </button>
          <button className="btn btn-secondary" onClick={copyInviteLink}>
            📋 Invite Friends
          </button>
          <button className="btn btn-secondary" onClick={() => navigate('/')}>
            ← Leave Room
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: showChat ? '2fr 1fr' : '1fr', gap: '20px', alignItems: 'start' }}>
        {/* Left Column - Player and Playlist */}
        <div>
          {/* Enhanced Player Controls */}
          <div className="player-controls-compact">
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <button 
                className={`btn btn-compact ${backgroundPlayback ? '' : 'btn-secondary'}`}
                onClick={toggleBackgroundPlayback}
                title={backgroundPlayback ? 'Disable background playback' : 'Enable background playback'}
              >
                {backgroundPlayback ? '🔊 BG On' : '🔇 BG Off'}
              </button>
              
              <button 
                className={`btn btn-compact ${playerVisible ? '' : 'btn-secondary'}`}
                onClick={togglePlayerVisibility}
                title={playerVisible ? 'Hide player' : 'Show player'}
              >
                {playerVisible ? '👁️ Show' : '🙈 Hide'}
              </button>

              {playerVisible && (
                <button 
                  className={`btn btn-compact ${miniPlayer ? '' : 'btn-secondary'}`}
                  onClick={toggleMiniPlayer}
                  title={miniPlayer ? 'Normal size' : 'Mini player'}
                >
                  {miniPlayer ? '📱 Mini' : '🖥️ Full'}
                </button>
              )}
            </div>
            
            {/* Now Playing Info (visible when player is hidden) */}
            {!playerVisible && currentVideo && (
              <div className={`now-playing-info ${!playerVisible ? 'hidden-player' : ''}`}>
                <div style={{ fontSize: '20px' }}>🎵</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '14px', fontWeight: '600', color: '#f8fafc' }}>
                    Now Playing: {currentVideo.title}
                  </div>
                  <div style={{ fontSize: '12px', color: '#a1a1aa' }}>
                    {currentVideo.channelTitle}
                  </div>
                </div>
                <div style={{ 
                  color: isPlaying ? '#10b981' : '#ef4444',
                  fontSize: '12px',
                  fontWeight: '600'
                }}>
                  {isPlaying ? '▶️ Playing' : '⏸️ Paused'}
                </div>
              </div>
            )}
          </div>

          {/* Player Container */}
          {playerVisible && (
            <div className={`player-container ${miniPlayer ? 'mini' : ''}`}>
              <div id="youtube-player">
                {!currentVideo && (
                  <div style={{ 
                    height: miniPlayer ? '120px' : '400px', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                    background: 'rgba(255, 255, 255, 0.02)',
                    color: '#a1a1aa',
                    fontSize: miniPlayer ? '14px' : '18px',
                    flexDirection: 'column',
                    gap: '16px'
                  }}>
                    <div style={{ fontSize: miniPlayer ? '24px' : '48px' }}>🎵</div>
                    <div>No video playing. Add a video to get started!</div>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="controls">
            <button className="btn" onClick={handlePlay} disabled={!currentVideo}>
              ▶️ Play
            </button>
            <button className="btn btn-secondary" onClick={handlePause} disabled={!currentVideo}>
              ⏸️ Pause
            </button>
            <button className="btn btn-secondary" onClick={handleNext} disabled={playlist.length <= 1}>
              ⏭️ Next
            </button>
            <button className="btn btn-secondary" onClick={() => setShowChat(!showChat)}>
              {showChat ? '💬 Hide Chat' : '💬 Show Chat'}
            </button>
          </div>

          {/* Add Video Section */}
          <div style={{ 
            background: 'rgba(255, 255, 255, 0.05)', 
            borderRadius: '16px', 
            padding: '24px', 
            marginBottom: '24px',
            border: '1px solid rgba(255, 255, 255, 0.1)'
          }}>
            <h3 style={{ marginBottom: '20px', color: '#f8fafc' }}>Add Videos to Playlist</h3>
            
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <button 
                className="btn"
                onClick={() => setShowSearch(true)}
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '8px',
                  flex: '1',
                  minWidth: '200px'
                }}
              >
                <span>🔍</span>
                Search YouTube
              </button>
              
              <div style={{ 
                flex: '2', 
                minWidth: '300px',
                display: 'flex',
                gap: '12px'
              }}>
                <input
                  type="text"
                  placeholder="Or paste YouTube URL directly..."
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  style={{
                    flex: 1,
                    padding: '12px 16px',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    borderRadius: '10px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    color: 'white'
                  }}
                />
                <button 
                  onClick={addToPlaylist} 
                  className="btn"
                  disabled={!videoUrl.trim()}
                >
                  Add URL
                </button>
              </div>
            </div>
          </div>

          {/* Playlist */}
          <div className="playlist">
            <h3 style={{ color: '#f8fafc', marginBottom: '20px' }}>Playlist ({playlist.length} videos)</h3>
            {playlist.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#a1a1aa', padding: '40px 20px' }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎶</div>
                <p style={{ fontSize: '16px' }}>No videos in playlist. Add some using the search above!</p>
              </div>
            ) : (
              playlist.map((video, index) => (
                <div 
                  key={video.id} 
                  className={`playlist-item ${currentVideo?.id === video.id ? 'current-video' : ''}`}
                >
                  {video.thumbnail && (
                    <img
                      src={video.thumbnail}
                      alt={video.title}
                      style={{
                        width: '80px',
                        height: '60px',
                        borderRadius: '8px',
                        flexShrink: 0
                      }}
                    />
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ 
                      display: 'flex', 
                      justifyContent: 'space-between', 
                      alignItems: 'flex-start',
                      marginBottom: '6px',
                      flexWrap: 'wrap',
                      gap: '10px'
                    }}>
                      <strong style={{ fontSize: '15px', lineHeight: '1.4', color: '#f8fafc' }}>
                        {index + 1}. {video.title}
                      </strong>
                      {currentVideo?.id === video.id && (
                        <span style={{ 
                          color: '#6366f1', 
                          fontSize: '12px',
                          background: 'rgba(99, 102, 241, 0.1)',
                          padding: '4px 12px',
                          borderRadius: '12px',
                          fontWeight: '600'
                        }}>
                          ▶️ Now Playing
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '13px', color: '#a1a1aa', marginBottom: '4px', fontWeight: '500' }}>
                      {video.channelTitle || 'YouTube Video'}
                    </div>
                    <small style={{ color: '#71717a' }}>
                      Added by {video.addedBy}
                    </small>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Column - Chat */}
        {showChat && (
          <div className="chat-container">
            <h3 style={{ color: '#f8fafc', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              💬 Room Chat
            </h3>
            
            {/* Messages */}
            <div 
              ref={chatContainerRef}
              className="chat-messages"
            >
              {messages.map((message) => (
                <div 
                  key={message.id}
                  className={`chat-message ${message.type === 'system' ? 'system' : ''}`}
                >
                  <div className="chat-message-header">
                    <span className={`chat-username ${message.type === 'system' ? 'system' : ''}`}>
                      {message.userName}
                    </span>
                    <span className="chat-timestamp">
                      {new Date(message.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="chat-text">
                    {message.message}
                  </div>
                </div>
              ))}
              
              {messages.length === 0 && (
                <div style={{ textAlign: 'center', color: '#a1a1aa', padding: '40px 20px' }}>
                  <div style={{ fontSize: '32px', marginBottom: '8px' }}>💬</div>
                  <p>No messages yet. Start the conversation!</p>
                </div>
              )}
            </div>

            {/* Message Input */}
            <form onSubmit={sendMessage} className="chat-input-form">
              <input
                type="text"
                placeholder="Type a message..."
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                className="chat-input"
              />
              <button 
                type="submit" 
                className="btn"
                disabled={!newMessage.trim()}
                style={{ padding: '12px 16px' }}
              >
                Send
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Background Playback Status Bar */}
      {!playerVisible && currentVideo && (
        <div className="background-status">
          <div style={{ fontSize: '20px' }}>🎵</div>
          <div style={{ fontSize: '14px', color: 'white' }}>
            <strong>{currentVideo.title}</strong>
            <div style={{ fontSize: '12px', color: '#a1a1aa' }}>
              {isPlaying ? '▶️ Playing' : '⏸️ Paused'} • {currentVideo.channelTitle}
            </div>
          </div>
          <button 
            onClick={togglePlayerVisibility}
            style={{
              background: '#6366f1',
              border: 'none',
              color: 'white',
              padding: '6px 12px',
              borderRadius: '15px',
              cursor: 'pointer',
              fontSize: '12px'
            }}
          >
            Show Player
          </button>
        </div>
      )}

      <YouTubeSearch
        onAddToPlaylist={handleAddFromSearch}
        isOpen={showSearch}
        onClose={() => setShowSearch(false)}
      />
    </div>
  );
}

export default Room;