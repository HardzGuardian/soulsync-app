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
  const [syncStatus, setSyncStatus] = useState('Connecting...');
  const [showSearch, setShowSearch] = useState(false);
  // Chat state
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [showChat, setShowChat] = useState(true);
  // New states for video hide and player size
  const [showVideo, setShowVideo] = useState(true);
  const [playerSize, setPlayerSize] = useState('full'); // 'full', 'mini'
  const [isSyncing, setIsSyncing] = useState(false);
  const [currentController, setCurrentController] = useState(null);
  
  const playerRef = useRef(null);
  const hiddenPlayerRef = useRef(null);
  const chatContainerRef = useRef(null);
  const hasJoinedRef = useRef(false);
  const playerInitializedRef = useRef(false);

  // Setup socket connection with proper reconnection handling
  useEffect(() => {
    if (!userName) {
      navigate('/');
      return;
    }

    if (socket) {
      return;
    }

    const socketUrl = import.meta.env.MODE === 'development' 
      ? 'http://localhost:3001' 
      : window.location.origin;

    console.log('Connecting to socket:', socketUrl);

    const newSocket = io(socketUrl, {
      reconnection: true,
      reconnectionAttempts: 3,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      autoConnect: true,
      transports: ['websocket', 'polling']
    });

    setSocket(newSocket);

    newSocket.on('connect', () => {
      console.log('Socket connected successfully:', newSocket.id);
      setSyncStatus('Connected');
      
      if (!hasJoinedRef.current) {
        newSocket.emit('join-room', { roomId, userName });
        hasJoinedRef.current = true;
      }
    });

    newSocket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
      setSyncStatus('Disconnected');
    });

    newSocket.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
      setSyncStatus('Connection Error');
    });

    // Event listeners
    newSocket.on('room-state', (state) => {
      console.log('Received room state');
      setPlaylist(state.playlist || []);
      setCurrentVideo(state.currentVideo);
      setIsPlaying(state.isPlaying || false);
      setMessages(state.messages || []);
      setCurrentController(state.currentController || null);
    });

    newSocket.on('playlist-updated', (updatedPlaylist) => {
      setPlaylist(updatedPlaylist);
    });
    
    newSocket.on('video-changed', ({ video, isPlaying: playing, controller }) => {
      setCurrentVideo(video);
      setIsPlaying(playing);
      setCurrentController(controller);
      playerInitializedRef.current = false;
      initializePlayers();
    });

    newSocket.on('video-played', ({ controller }) => {
      setIsPlaying(true);
      setCurrentController(controller);
      if (playerRef.current && showVideo) {
        playerRef.current.playVideo();
      }
      if (hiddenPlayerRef.current && !showVideo) {
        hiddenPlayerRef.current.playVideo();
      }
    });

    newSocket.on('video-paused', ({ controller }) => {
      setIsPlaying(false);
      setCurrentController(controller);
      if (playerRef.current && showVideo) {
        playerRef.current.pauseVideo();
      }
      if (hiddenPlayerRef.current && !showVideo) {
        hiddenPlayerRef.current.pauseVideo();
      }
    });

    newSocket.on('video-seeked', ({ time, controller }) => {
      setCurrentController(controller);
      if (playerRef.current && showVideo) {
        playerRef.current.seekTo(time, true);
      }
      if (hiddenPlayerRef.current && !showVideo) {
        hiddenPlayerRef.current.seekTo(time, true);
      }
    });

    // Manual sync response - FIXED
    newSocket.on('sync-response', ({ time, isPlaying: serverPlaying, videoId, controller }) => {
      console.log('Sync response received:', { time, serverPlaying, videoId, controller });
      if (currentVideo?.videoId === videoId) {
        // Sync both players
        if (playerRef.current && showVideo) {
          playerRef.current.seekTo(time, true);
          if (serverPlaying) {
            playerRef.current.playVideo();
          } else {
            playerRef.current.pauseVideo();
          }
        }
        if (hiddenPlayerRef.current && !showVideo) {
          hiddenPlayerRef.current.seekTo(time, true);
          if (serverPlaying) {
            hiddenPlayerRef.current.playVideo();
          } else {
            hiddenPlayerRef.current.pauseVideo();
          }
        }
        
        setIsPlaying(serverPlaying);
        setCurrentController(controller);
        setSyncStatus(`Synced with ${controller}`);
        setIsSyncing(false);
        setTimeout(() => setSyncStatus('Connected'), 3000);
      }
    });

    newSocket.on('controller-updated', ({ controller }) => {
      setCurrentController(controller);
    });

    // Chat events
    newSocket.on('new-message', (message) => {
      setMessages(prev => [...prev, message]);
    });

    newSocket.on('user-joined', ({ userName: joinedUser, userCount }) => {
      if (joinedUser !== userName) {
        const systemMessage = {
          id: Date.now().toString() + Math.random(),
          userName: 'System',
          message: `${joinedUser} joined the room`,
          timestamp: new Date(),
          type: 'system'
        };
        setMessages(prev => [...prev, systemMessage]);
      }
    });

    newSocket.on('user-left', ({ userName: leftUser, userCount }) => {
      if (leftUser !== userName) {
        const systemMessage = {
          id: Date.now().toString() + Math.random(),
          userName: 'System',
          message: `${leftUser} left the room`,
          timestamp: new Date(),
          type: 'system'
        };
        setMessages(prev => [...prev, systemMessage]);
      }
    });

    newSocket.on('error', (error) => {
      console.error('Socket error:', error);
      alert(error.message);
      navigate('/');
    });

    return () => {
      console.log('Cleaning up socket connection');
      if (newSocket) {
        newSocket.removeAllListeners();
        newSocket.disconnect();
      }
      hasJoinedRef.current = false;
    };
  }, [roomId, userName, navigate]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  // Initialize YouTube Players when currentVideo changes
  useEffect(() => {
    if (currentVideo && !playerInitializedRef.current) {
      initializePlayers();
    }
  }, [currentVideo]);

  // Initialize YouTube Players
  const initializePlayers = () => {
    if (!currentVideo) return;

    // Load YouTube API if not already loaded
    if (!window.YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

      window.onYouTubeIframeAPIReady = () => {
        createPlayers();
      };
    } else {
      createPlayers();
    }
  };

  const createPlayers = () => {
    if (!currentVideo) return;

    // Destroy existing players
    if (playerRef.current) {
      try { playerRef.current.destroy(); } catch (e) {}
    }
    if (hiddenPlayerRef.current) {
      try { hiddenPlayerRef.current.destroy(); } catch (e) {}
    }

    // Create visible player only if showVideo is true
    if (showVideo) {
      const playerHeight = playerSize === 'mini' ? '200' : '400';
      const playerWidth = playerSize === 'mini' ? '356' : '100%';

      playerRef.current = new window.YT.Player('youtube-player', {
        height: playerHeight,
        width: playerWidth,
        videoId: currentVideo.videoId,
        playerVars: {
          playsinline: 1,
          enablejsapi: 1,
          origin: window.location.origin,
          autoplay: isPlaying ? 1 : 0,
          controls: 1,
          rel: 0,
          modestbranding: 1
        },
        events: {
          onReady: (event) => {
            console.log('Visible player ready');
            playerInitializedRef.current = true;
            if (isPlaying) {
              event.target.playVideo();
            }
          },
          onStateChange: onPlayerStateChange,
          onError: (error) => {
            console.error('Visible player error:', error);
          }
        }
      });
    }

    // Create hidden player for audio continuation
    hiddenPlayerRef.current = new window.YT.Player('hidden-youtube-player', {
      height: '0',
      width: '0',
      videoId: currentVideo.videoId,
      playerVars: {
        playsinline: 1,
        enablejsapi: 1,
        origin: window.location.origin,
        autoplay: !showVideo && isPlaying ? 1 : 0, // Only autoplay if video is hidden
        controls: 0,
        modestbranding: 1,
        rel: 0
      },
      events: {
        onReady: (event) => {
          console.log('Hidden player ready');
          playerInitializedRef.current = true;
          // Only play hidden player if video is hidden
          if (!showVideo && isPlaying) {
            event.target.playVideo();
          }
        },
        onStateChange: onHiddenPlayerStateChange,
        onError: (error) => {
          console.error('Hidden player error:', error);
        }
      }
    });
  };

  const onPlayerStateChange = (event) => {
    // Only handle events from the active player
    if (!showVideo) return;
    
    if (event.data === window.YT.PlayerState.PLAYING) {
      setIsPlaying(true);
      // Sync with server
      if (socket) {
        socket.emit('play-video');
      }
      // Pause hidden player to avoid double audio
      if (hiddenPlayerRef.current) {
        hiddenPlayerRef.current.pauseVideo();
      }
    } else if (event.data === window.YT.PlayerState.PAUSED) {
      setIsPlaying(false);
      if (socket) {
        socket.emit('pause-video');
      }
    } else if (event.data === window.YT.PlayerState.ENDED) {
      setIsPlaying(false);
      if (socket) {
        socket.emit('next-video');
      }
    }
  };

  const onHiddenPlayerStateChange = (event) => {
    // Only handle events from the hidden player when video is hidden
    if (showVideo) return;
    
    if (event.data === window.YT.PlayerState.PLAYING) {
      setIsPlaying(true);
      if (socket) {
        socket.emit('play-video');
      }
    } else if (event.data === window.YT.PlayerState.PAUSED) {
      setIsPlaying(false);
      if (socket) {
        socket.emit('pause-video');
      }
    } else if (event.data === window.YT.PlayerState.ENDED) {
      setIsPlaying(false);
      if (socket) {
        socket.emit('next-video');
      }
    }
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
    if (socket) {
      socket.emit('play-video');
      setIsPlaying(true);
      
      // Only play the active player
      if (showVideo && playerRef.current) {
        playerRef.current.playVideo();
        if (hiddenPlayerRef.current) {
          hiddenPlayerRef.current.pauseVideo(); // Ensure hidden player is paused
        }
      } else if (!showVideo && hiddenPlayerRef.current) {
        hiddenPlayerRef.current.playVideo();
        if (playerRef.current) {
          playerRef.current.pauseVideo(); // Ensure visible player is paused
        }
      }
    }
  };

  const handlePause = () => {
    if (socket) {
      socket.emit('pause-video');
      setIsPlaying(false);
      
      // Pause both players to be safe
      if (playerRef.current) {
        playerRef.current.pauseVideo();
      }
      if (hiddenPlayerRef.current) {
        hiddenPlayerRef.current.pauseVideo();
      }
    }
  };

  const handleNext = () => {
    if (socket) {
      socket.emit('next-video');
    }
  };

  const handleManualSync = () => {
    if (socket) {
      setIsSyncing(true);
      setSyncStatus('Syncing with current controller...');
      socket.emit('request-sync');
      
      // Auto reset syncing state after 5 seconds
      setTimeout(() => {
        if (isSyncing) {
          setIsSyncing(false);
          setSyncStatus('Sync timeout');
          setTimeout(() => setSyncStatus('Connected'), 3000);
        }
      }, 5000);
    }
  };

  const toggleVideoVisibility = () => {
    const newShowVideo = !showVideo;
    setShowVideo(newShowVideo);
    
    // Store current state before switching
    const wasPlaying = isPlaying;
    let currentTime = 0;
    
    // Get current time from active player
    if (newShowVideo && hiddenPlayerRef.current) {
      // Switching to video mode - get time from hidden player
      try {
        currentTime = hiddenPlayerRef.current.getCurrentTime();
      } catch (e) {
        console.error('Error getting time from hidden player:', e);
      }
      // Stop hidden player
      if (hiddenPlayerRef.current) {
        hiddenPlayerRef.current.pauseVideo();
      }
    } else if (!newShowVideo && playerRef.current) {
      // Switching to audio mode - get time from visible player
      try {
        currentTime = playerRef.current.getCurrentTime();
      } catch (e) {
        console.error('Error getting time from visible player:', e);
      }
      // Stop visible player
      if (playerRef.current) {
        playerRef.current.pauseVideo();
      }
    }
    
    // Reset initialization flag to force reinitialization
    playerInitializedRef.current = false;
    
    // Small delay to ensure DOM is updated
    setTimeout(() => {
      if (currentVideo) {
        // Reinitialize players with the new visibility setting
        initializePlayers();
        
        // After players are ready, seek to the correct time and set play state
        const waitForPlayer = setInterval(() => {
          if (playerInitializedRef.current) {
            clearInterval(waitForPlayer);
            
            // Seek to correct time
            if (newShowVideo && playerRef.current) {
              playerRef.current.seekTo(currentTime, true);
              if (wasPlaying) {
                playerRef.current.playVideo();
              }
            } else if (!newShowVideo && hiddenPlayerRef.current) {
              hiddenPlayerRef.current.seekTo(currentTime, true);
              if (wasPlaying) {
                hiddenPlayerRef.current.playVideo();
              }
            }
          }
        }, 100);
        
        // Timeout after 3 seconds
        setTimeout(() => clearInterval(waitForPlayer), 3000);
      }
    }, 100);
  };

  const togglePlayerSize = () => {
    setPlayerSize(prev => prev === 'full' ? 'mini' : 'full');
    // Reset player when size changes
    playerInitializedRef.current = false;
    setTimeout(() => {
      if (currentVideo && showVideo) {
        initializePlayers();
      }
    }, 100);
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
      {/* Hidden YouTube Player for Audio Continuation */}
      <div id="hidden-youtube-player" style={{ display: 'none' }}></div>

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
            <span className="sync-status"> {syncStatus}</span>
            {currentController && (
              <span style={{ color: '#8b5cf6', marginLeft: '10px', fontSize: '12px' }}>
                🎮 Controlled by: {currentController}
              </span>
            )}
            {!showVideo && (
              <span style={{ color: '#f59e0b', marginLeft: '10px', fontSize: '12px' }}>
                🔊 Audio Only Mode
              </span>
            )}
            {playerSize === 'mini' && (
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
          {/* Player Controls */}
          <div className="player-controls-compact">
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <button 
                className={`btn btn-compact ${showVideo ? '' : 'btn-secondary'}`}
                onClick={toggleVideoVisibility}
                title={showVideo ? 'Hide video (keep audio)' : 'Show video'}
              >
                {showVideo ? '👁️ Show' : '🙈 Hide'} Video
              </button>

              {showVideo && (
                <button 
                  className={`btn btn-compact ${playerSize === 'mini' ? '' : 'btn-secondary'}`}
                  onClick={togglePlayerSize}
                  title={playerSize === 'mini' ? 'Full player' : 'Mini player'}
                >
                  {playerSize === 'mini' ? '📱 Mini' : '🖥️ Full'} Player
                </button>
              )}

              <button 
                className="btn btn-compact"
                onClick={handleManualSync}
                disabled={isSyncing || !currentVideo}
                title="Sync with current controller"
              >
                {isSyncing ? '⏳' : '🔄'} Sync
              </button>
            </div>
            
            {/* Now Playing Info (visible when video is hidden) */}
            {!showVideo && currentVideo && (
              <div className="now-playing-info">
                <div style={{ fontSize: '24px' }}>🎵</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '16px', fontWeight: '600', color: '#f8fafc' }}>
                    Now Playing: {currentVideo.title}
                  </div>
                  <div style={{ fontSize: '14px', color: '#a1a1aa' }}>
                    {currentVideo.channelTitle}
                    {currentController && ` • Controlled by: ${currentController}`}
                  </div>
                </div>
                <div style={{ 
                  color: isPlaying ? '#10b981' : '#ef4444',
                  fontSize: '14px',
                  fontWeight: '600'
                }}>
                  {isPlaying ? '▶️ Playing' : '⏸️ Paused'}
                </div>
              </div>
            )}
          </div>

          {/* Player Container */}
          {showVideo && (
            <div className={`player-container ${playerSize === 'mini' ? 'mini' : ''}`}>
              <div id="youtube-player">
                {!currentVideo && (
                  <div style={{ 
                    height: playerSize === 'mini' ? '200px' : '400px', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                    background: 'rgba(255, 255, 255, 0.02)',
                    color: '#a1a1aa',
                    fontSize: playerSize === 'mini' ? '14px' : '18px',
                    flexDirection: 'column',
                    gap: '16px'
                  }}>
                    <div style={{ fontSize: playerSize === 'mini' ? '32px' : '48px' }}>🎵</div>
                    <div>No video playing. Add a video to get started!</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Main Controls */}
          <div className="controls">
            <button 
              className={`btn ${isPlaying ? 'btn-secondary' : 'btn-play'}`} 
              onClick={handlePlay} 
              disabled={!currentVideo || isPlaying}
            >
              {isPlaying ? '▶️ Playing' : '▶️ Play'}
            </button>
            <button 
              className={`btn ${!isPlaying ? 'btn-secondary' : 'btn-pause'}`} 
              onClick={handlePause} 
              disabled={!currentVideo || !isPlaying}
            >
              {!isPlaying ? '⏸️ Paused' : '⏸️ Pause'}
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
                          {isPlaying ? '▶️ Now Playing' : '⏸️ Paused'}
                          {currentController && ` • 🎮 ${currentController}`}
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

      {/* REMOVED: Background Audio Status Bar */}

      <YouTubeSearch
        onAddToPlaylist={handleAddFromSearch}
        isOpen={showSearch}
        onClose={() => setShowSearch(false)}
      />
    </div>
  );
}

export default Room;