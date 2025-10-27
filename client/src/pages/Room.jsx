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
  const [videoUrl, setVideoUrl] = useState('');
  const [syncStatus, setSyncStatus] = useState('Connecting...');
  const [showSearch, setShowSearch] = useState(false);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [showChat, setShowChat] = useState(true);
  const [showVideo, setShowVideo] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [currentController, setCurrentController] = useState(null);
  
  const playerRef = useRef(null);
  const chatContainerRef = useRef(null);
  const hasJoinedRef = useRef(false);
  const playerInitializedRef = useRef(false);
  const isTogglingVideoRef = useRef(false);
  const socketRef = useRef(null);

  // Setup socket connection
  useEffect(() => {
    if (!userName) {
      navigate('/');
      return;
    }

    if (socket) return;

    const socketUrl = import.meta.env.MODE === 'development' 
      ? 'http://localhost:3001' 
      : window.location.origin;

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
    socketRef.current = newSocket;

    newSocket.on('connect', () => {
      console.log('Socket connected:', newSocket.id);
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

    newSocket.on('room-state', (state) => {
      console.log('Received room state:', state);
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
      console.log('Video changed:', video?.title);
      setCurrentVideo(video);
      setIsPlaying(playing);
      setCurrentController(controller);
      playerInitializedRef.current = false;
    });

    newSocket.on('video-played', ({ controller }) => {
      console.log('Video played by:', controller);
      setIsPlaying(true);
      setCurrentController(controller);
      if (playerRef.current && !isTogglingVideoRef.current) {
        try {
          playerRef.current.playVideo();
        } catch (e) {
          console.error('Error playing video:', e);
        }
      }
    });

    newSocket.on('video-paused', ({ controller }) => {
      console.log('Video paused by:', controller);
      setIsPlaying(false);
      setCurrentController(controller);
      if (playerRef.current && !isTogglingVideoRef.current) {
        try {
          playerRef.current.pauseVideo();
        } catch (e) {
          console.error('Error pausing video:', e);
        }
      }
    });

    newSocket.on('video-seeked', ({ time, controller }) => {
      console.log('Video seeked to:', time, 'by:', controller);
      setCurrentController(controller);
      if (playerRef.current && !isTogglingVideoRef.current) {
        try {
          playerRef.current.seekTo(time, true);
        } catch (e) {
          console.error('Error seeking video:', e);
        }
      }
    });

    newSocket.on('sync-response', ({ time, isPlaying: serverPlaying, videoId, controller }) => {
      console.log('Sync response received:', { time, serverPlaying, videoId, controller });
      
      // Always reset syncing state
      setIsSyncing(false);
      
      if (!currentVideo || currentVideo.videoId !== videoId) {
        console.log('Video ID mismatch, skipping sync');
        setSyncStatus('Video changed');
        setTimeout(() => setSyncStatus('Connected'), 2000);
        return;
      }

      if (playerRef.current && playerInitializedRef.current) {
        try {
          console.log('Syncing player to:', time, serverPlaying ? 'playing' : 'paused');
          playerRef.current.seekTo(time, true);
          
          // Wait a moment for seek to complete
          setTimeout(() => {
            if (serverPlaying) {
              playerRef.current.playVideo();
            } else {
              playerRef.current.pauseVideo();
            }
          }, 100);
          
          setIsPlaying(serverPlaying);
          setCurrentController(controller);
          setSyncStatus(`Synced with ${controller}`);
          setTimeout(() => setSyncStatus('Connected'), 3000);
        } catch (e) {
          console.error('Error during sync:', e);
          setSyncStatus('Sync failed');
          setTimeout(() => setSyncStatus('Connected'), 2000);
        }
      } else {
        console.log('Player not ready for sync');
        setSyncStatus('Player not ready');
        setTimeout(() => setSyncStatus('Connected'), 2000);
      }
    });

    newSocket.on('controller-updated', ({ controller }) => {
      setCurrentController(controller);
    });

    newSocket.on('new-message', (message) => {
      setMessages(prev => [...prev, message]);
    });

    newSocket.on('user-joined', ({ userName: joinedUser }) => {
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

    newSocket.on('user-left', ({ userName: leftUser }) => {
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
      if (newSocket) {
        newSocket.removeAllListeners();
        newSocket.disconnect();
      }
      socketRef.current = null;
      hasJoinedRef.current = false;
    };
  }, [roomId, userName, navigate, currentVideo]);

  // Auto-scroll chat
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  // Initialize YouTube Player
  useEffect(() => {
    if (currentVideo && !playerInitializedRef.current && !isTogglingVideoRef.current) {
      initializePlayer();
    }
  }, [currentVideo, showVideo]);

  const initializePlayer = () => {
    if (!currentVideo || isTogglingVideoRef.current) return;

    if (!window.YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

      window.onYouTubeIframeAPIReady = () => {
        createPlayer();
      };
    } else {
      createPlayer();
    }
  };

  const createPlayer = () => {
    if (!currentVideo || isTogglingVideoRef.current) return;

    if (playerRef.current) {
      try { 
        playerRef.current.destroy(); 
      } catch (e) {
        console.error('Error destroying player:', e);
      }
    }

    const playerDiv = document.getElementById('youtube-player');
    if (!playerDiv) {
      console.error('Player div not found');
      return;
    }

    try {
      playerRef.current = new window.YT.Player('youtube-player', {
        height: showVideo ? '400' : '0',
        width: showVideo ? '100%' : '0',
        videoId: currentVideo.videoId,
        playerVars: {
          playsinline: 1,
          enablejsapi: 1,
          origin: window.location.origin,
          autoplay: isPlaying ? 1 : 0,
          controls: showVideo ? 1 : 0,
          rel: 0,
          modestbranding: 1
        },
        events: {
          onReady: (event) => {
            console.log('Player ready');
            playerInitializedRef.current = true;
            if (isPlaying) {
              setTimeout(() => {
                event.target.playVideo();
              }, 100);
            }
          },
          onStateChange: onPlayerStateChange,
          onError: (error) => {
            console.error('Player error:', error);
          }
        }
      });
    } catch (error) {
      console.error('Error creating player:', error);
    }
  };

  const onPlayerStateChange = (event) => {
    if (isTogglingVideoRef.current) return;

    if (event.data === window.YT.PlayerState.PLAYING) {
      if (!isPlaying) {
        setIsPlaying(true);
        if (socketRef.current) socketRef.current.emit('play-video');
      }
    } else if (event.data === window.YT.PlayerState.PAUSED) {
      if (isPlaying) {
        setIsPlaying(false);
        if (socketRef.current) socketRef.current.emit('pause-video');
      }
    } else if (event.data === window.YT.PlayerState.ENDED) {
      setIsPlaying(false);
      if (socketRef.current) socketRef.current.emit('next-video');
    }
  };

  const extractVideoId = (url) => {
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
    const match = url.match(regex);
    return match ? match[1] : null;
  };

  const addToPlaylist = async (e) => {
    e.preventDefault();
    if (!videoUrl.trim() || !socketRef.current) return;

    const videoId = extractVideoId(videoUrl);
    if (!videoId) {
      alert('Please enter a valid YouTube URL');
      return;
    }

    try {
      const videoInfo = await youtubeAPI.getVideoInfo(videoId);
      socketRef.current.emit('add-to-playlist', {
        videoId: videoInfo.videoId,
        title: videoInfo.title,
        thumbnail: videoInfo.thumbnail,
        channelTitle: videoInfo.channelTitle
      });
    } catch (error) {
      socketRef.current.emit('add-to-playlist', {
        videoId,
        title: `YouTube Video (${videoId})`,
        thumbnail: `https://i.ytimg.com/vi/${videoId}/default.jpg`,
        channelTitle: 'YouTube'
      });
    }

    setVideoUrl('');
  };

  const handleAddFromSearch = (videoData) => {
    if (!socketRef.current) return;
    socketRef.current.emit('add-to-playlist', {
      videoId: videoData.videoId,
      title: videoData.title,
      thumbnail: videoData.thumbnail,
      channelTitle: videoData.channelTitle
    });
  };

  const handlePlay = () => {
    if (socketRef.current && playerRef.current) {
      socketRef.current.emit('play-video');
      setIsPlaying(true);
      playerRef.current.playVideo();
    }
  };

  const handlePause = () => {
    if (socketRef.current && playerRef.current) {
      socketRef.current.emit('pause-video');
      setIsPlaying(false);
      playerRef.current.pauseVideo();
    }
  };

  const handleNext = () => {
    if (socketRef.current) {
      socketRef.current.emit('next-video');
    }
  };

  const handleManualSync = () => {
    if (!socketRef.current || !currentVideo || !playerInitializedRef.current) {
      alert('Player not ready. Please wait for the video to load.');
      return;
    }

    console.log('Requesting sync...');
    setIsSyncing(true);
    setSyncStatus('Syncing...');
    socketRef.current.emit('request-sync');
    
    // Fallback timeout
    setTimeout(() => {
      if (isSyncing) {
        console.log('Sync timeout');
        setIsSyncing(false);
        setSyncStatus('Sync timeout - try again');
        setTimeout(() => setSyncStatus('Connected'), 2000);
      }
    }, 5000);
  };

  const toggleVideoVisibility = () => {
    if (!playerRef.current || !currentVideo) return;
    
    isTogglingVideoRef.current = true;
    const newShowVideo = !showVideo;
    
    try {
      // Get current state before toggling
      const currentTime = playerRef.current.getCurrentTime();
      const wasPlaying = isPlaying;
      
      console.log('Toggling video visibility. Current time:', currentTime, 'Playing:', wasPlaying);
      
      // Update visibility state
      setShowVideo(newShowVideo);
      
      // Wait for DOM to update, then recreate player
      setTimeout(() => {
        playerInitializedRef.current = false;
        
        if (playerRef.current) {
          try {
            playerRef.current.destroy();
          } catch (e) {
            console.error('Error destroying player:', e);
          }
        }
        
        // Recreate player with new visibility
        const playerDiv = document.getElementById('youtube-player');
        if (!playerDiv) {
          isTogglingVideoRef.current = false;
          return;
        }
        
        playerRef.current = new window.YT.Player('youtube-player', {
          height: newShowVideo ? '400' : '0',
          width: newShowVideo ? '100%' : '0',
          videoId: currentVideo.videoId,
          playerVars: {
            playsinline: 1,
            enablejsapi: 1,
            origin: window.location.origin,
            autoplay: 0,
            controls: newShowVideo ? 1 : 0,
            rel: 0,
            modestbranding: 1
          },
          events: {
            onReady: (event) => {
              console.log('Player recreated, restoring state');
              playerInitializedRef.current = true;
              
              // Restore playback position and state
              event.target.seekTo(currentTime, true);
              
              if (wasPlaying) {
                setTimeout(() => {
                  event.target.playVideo();
                }, 200);
              }
              
              setTimeout(() => {
                isTogglingVideoRef.current = false;
              }, 300);
            },
            onStateChange: onPlayerStateChange,
            onError: (error) => {
              console.error('Player error:', error);
              isTogglingVideoRef.current = false;
            }
          }
        });
      }, 100);
    } catch (error) {
      console.error('Error toggling video:', error);
      isTogglingVideoRef.current = false;
    }
  };

  const sendMessage = (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !socketRef.current) return;
    socketRef.current.emit('send-message', { message: newMessage.trim() });
    setNewMessage('');
  };

  const copyInviteLink = () => {
    const inviteLink = `${window.location.origin}?room=${roomId}`;
    navigator.clipboard.writeText(inviteLink);
    alert('Invite link copied! Share it with friends.');
  };

  if (!userName) {
    return <div className="container"><p>Loading...</p></div>;
  }

  return (
    <div className="container">
      {/* Header */}
      <div className="room-header">
        <div>
          <h1 className="room-title">SoulSync Room</h1>
          <p style={{ color: '#a1a1aa', margin: '8px 0 0 0', fontSize: '14px' }}>
            Welcome, <strong>{userName}</strong>
            <span className="sync-status"> • {syncStatus}</span>
            {currentController && (
              <span style={{ color: '#8b5cf6', marginLeft: '8px' }}>
                🎮 {currentController}
              </span>
            )}
            {!showVideo && currentVideo && (
              <span style={{ color: '#f59e0b', marginLeft: '8px' }}>
                🔊 Audio Mode
              </span>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button className="btn btn-compact" onClick={() => setShowSearch(true)}>
            🔍 Search
          </button>
          <button className="btn btn-compact btn-secondary" onClick={copyInviteLink}>
            📋 Invite
          </button>
          <button className="btn btn-compact btn-secondary" onClick={() => navigate('/')}>
            ← Leave
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: showChat ? '2fr 1fr' : '1fr', gap: '20px' }}>
        {/* Main Content */}
        <div>
          {/* Player Controls */}
          <div className="player-controls-compact">
            <button 
              className="btn btn-compact"
              onClick={toggleVideoVisibility}
              disabled={!currentVideo}
              title={showVideo ? 'Hide video (audio only)' : 'Show video'}
            >
              {showVideo ? '👁️ Hide Video' : '🔊 Show Video'}
            </button>

            <button 
              className="btn btn-compact"
              onClick={handleManualSync}
              disabled={isSyncing || !currentVideo || !playerInitializedRef.current}
              title="Sync with controller"
            >
              {isSyncing ? '⏳ Syncing...' : '🔄 Sync'}
            </button>

            <button 
              className="btn btn-compact btn-secondary"
              onClick={() => setShowChat(!showChat)}
            >
              {showChat ? '💬 Hide Chat' : '💬 Show Chat'}
            </button>
          </div>

          {/* Now Playing (Audio Mode) */}
          {!showVideo && currentVideo && (
            <div className="now-playing-info">
              <div style={{ fontSize: '32px' }}>🎵</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '18px', fontWeight: '700', color: '#f8fafc', marginBottom: '4px' }}>
                  {currentVideo.title}
                </div>
                <div style={{ fontSize: '14px', color: '#a1a1aa' }}>
                  {currentVideo.channelTitle}
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

          {/* Player */}
          <div className="player-container" style={{ 
            display: showVideo ? 'block' : 'none',
            minHeight: showVideo ? '400px' : '0'
          }}>
            <div id="youtube-player">
              {!currentVideo && (
                <div style={{ 
                  height: '400px', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  flexDirection: 'column',
                  gap: '16px',
                  background: 'rgba(255, 255, 255, 0.02)',
                  color: '#a1a1aa'
                }}>
                  <div style={{ fontSize: '48px' }}>🎵</div>
                  <div>Add a video to start listening together!</div>
                </div>
              )}
            </div>
          </div>

          {/* Playback Controls */}
          <div className="controls">
            <button 
              className={`btn ${isPlaying ? 'btn-secondary' : 'btn-play'}`}
              onClick={handlePlay} 
              disabled={!currentVideo || isPlaying}
            >
              ▶️ Play
            </button>
            <button 
              className={`btn ${!isPlaying ? 'btn-secondary' : 'btn-pause'}`}
              onClick={handlePause} 
              disabled={!currentVideo || !isPlaying}
            >
              ⏸️ Pause
            </button>
            <button 
              className="btn btn-secondary" 
              onClick={handleNext} 
              disabled={playlist.length <= 1}
            >
              ⏭️ Next
            </button>
          </div>

          {/* Add Video */}
          <div className="add-video-section">
            <h3 style={{ marginBottom: '16px', color: '#f8fafc', fontSize: '18px' }}>Add Videos</h3>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <button 
                className="btn"
                onClick={() => setShowSearch(true)}
                style={{ flex: '0 0 auto' }}
              >
                🔍 Search YouTube
              </button>
              <input
                type="text"
                placeholder="Or paste YouTube URL..."
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === 'Enter') addToPlaylist(e);
                }}
                style={{
                  flex: '1',
                  minWidth: '250px',
                  padding: '12px 16px',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  borderRadius: '10px',
                  background: 'rgba(255, 255, 255, 0.05)',
                  color: 'white',
                  fontSize: '14px'
                }}
              />
              <button 
                onClick={addToPlaylist} 
                className="btn"
                disabled={!videoUrl.trim()}
              >
                Add
              </button>
            </div>
          </div>

          {/* Playlist */}
          <div className="playlist">
            <h3 style={{ color: '#f8fafc', marginBottom: '16px' }}>
              Playlist ({playlist.length})
            </h3>
            {playlist.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#a1a1aa', padding: '40px 20px' }}>
                <div style={{ fontSize: '48px', marginBottom: '12px' }}>🎶</div>
                <p>No videos yet. Add some above!</p>
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
                        objectFit: 'cover'
                      }}
                    />
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ 
                      display: 'flex', 
                      justifyContent: 'space-between', 
                      alignItems: 'flex-start',
                      marginBottom: '6px',
                      gap: '10px'
                    }}>
                      <strong style={{ color: '#f8fafc', fontSize: '15px' }}>
                        {index + 1}. {video.title}
                      </strong>
                      {currentVideo?.id === video.id && (
                        <span className="now-playing-badge">
                          {isPlaying ? '▶️ Playing' : '⏸️ Paused'}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '13px', color: '#a1a1aa', marginBottom: '4px' }}>
                      {video.channelTitle}
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

        {/* Chat */}
        {showChat && (
          <div className="chat-container">
            <h3 style={{ color: '#f8fafc', marginBottom: '16px' }}>💬 Chat</h3>
            <div ref={chatContainerRef} className="chat-messages">
              {messages.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#a1a1aa', padding: '40px 20px' }}>
                  <div style={{ fontSize: '32px', marginBottom: '8px' }}>💬</div>
                  <p>Start chatting!</p>
                </div>
              ) : (
                messages.map((message) => (
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
                    <div className="chat-text">{message.message}</div>
                  </div>
                ))
              )}
            </div>
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
                className="btn btn-compact"
                disabled={!newMessage.trim()}
              >
                Send
              </button>
            </form>
          </div>
        )}
      </div>

      <YouTubeSearch
        onAddToPlaylist={handleAddFromSearch}
        isOpen={showSearch}
        onClose={() => setShowSearch(false)}
      />
    </div>
  );
}

export default Room;