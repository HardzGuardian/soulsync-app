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
  const [connectionStatus, setConnectionStatus] = useState('Connecting...');
  const [showSearch, setShowSearch] = useState(false);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [showChat, setShowChat] = useState(true);
  const [showVideo, setShowVideo] = useState(true);
  const [currentController, setCurrentController] = useState(null);
  const [users, setUsers] = useState([]);
  
  const playerRef = useRef(null);
  const chatContainerRef = useRef(null);
  const hasJoinedRef = useRef(false);
  const playerInitializedRef = useRef(false);
  const socketRef = useRef(null);
  const ignoreNextStateChange = useRef(false);

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
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      autoConnect: true,
      transports: ['websocket', 'polling']
    });

    setSocket(newSocket);
    socketRef.current = newSocket;

    newSocket.on('connect', () => {
      console.log('Connected to server');
      setConnectionStatus('Connected');
      
      if (!hasJoinedRef.current) {
        newSocket.emit('join-room', { roomId, userName });
        hasJoinedRef.current = true;
      }
    });

    newSocket.on('disconnect', (reason) => {
      console.log('Disconnected:', reason);
      setConnectionStatus('Disconnected - Reconnecting...');
    });

    newSocket.on('connect_error', (error) => {
      console.error('Connection error:', error);
      setConnectionStatus('Connection Error');
    });

    newSocket.on('room-state', (state) => {
      console.log('Room state received:', state);
      setPlaylist(state.playlist || []);
      setCurrentVideo(state.currentVideo);
      setIsPlaying(state.isPlaying || false);
      setMessages(state.messages || []);
      setCurrentController(state.currentController || null);
      setUsers(state.users || []);
    });

    newSocket.on('playlist-updated', (updatedPlaylist) => {
      setPlaylist(updatedPlaylist);
    });
    
    newSocket.on('video-changed', ({ video, isPlaying: playing, currentTime, controller }) => {
      console.log('Video changed:', video?.title);
      setCurrentVideo(video);
      setIsPlaying(playing);
      setCurrentController(controller);
      playerInitializedRef.current = false;
      
      // Recreate player for new video
      if (video && playerRef.current) {
        ignoreNextStateChange.current = true;
        playerRef.current.loadVideoById(video.videoId, currentTime || 0);
        
        setTimeout(() => {
          if (playing && playerRef.current) {
            playerRef.current.playVideo();
          }
          ignoreNextStateChange.current = false;
        }, 500);
      }
    });

    newSocket.on('video-played', ({ controller, currentTime }) => {
      console.log('Play command from:', controller, 'at', currentTime);
      setIsPlaying(true);
      setCurrentController(controller);
      
      if (playerRef.current && playerInitializedRef.current) {
        ignoreNextStateChange.current = true;
        if (currentTime !== undefined) {
          playerRef.current.seekTo(currentTime, true);
        }
        playerRef.current.playVideo();
        setTimeout(() => { ignoreNextStateChange.current = false; }, 300);
      }
    });

    newSocket.on('video-paused', ({ controller, currentTime }) => {
      console.log('Pause command from:', controller, 'at', currentTime);
      setIsPlaying(false);
      setCurrentController(controller);
      
      if (playerRef.current && playerInitializedRef.current) {
        ignoreNextStateChange.current = true;
        if (currentTime !== undefined) {
          playerRef.current.seekTo(currentTime, true);
        }
        playerRef.current.pauseVideo();
        setTimeout(() => { ignoreNextStateChange.current = false; }, 300);
      }
    });

    newSocket.on('video-seeked', ({ time, controller }) => {
      console.log('Seek command from:', controller, 'to', time);
      setCurrentController(controller);
      
      if (playerRef.current && playerInitializedRef.current) {
        ignoreNextStateChange.current = true;
        playerRef.current.seekTo(time, true);
        setTimeout(() => { ignoreNextStateChange.current = false; }, 300);
      }
    });

    newSocket.on('new-message', (message) => {
      setMessages(prev => [...prev, message]);
    });

    newSocket.on('user-joined', ({ userName: joinedUser, users: updatedUsers }) => {
      setUsers(updatedUsers || []);
    });

    newSocket.on('user-left', ({ userName: leftUser, users: updatedUsers }) => {
      setUsers(updatedUsers || []);
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
  }, [roomId, userName, navigate]);

  // Auto-scroll chat
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  // Initialize YouTube Player
  useEffect(() => {
    if (currentVideo && !playerInitializedRef.current) {
      initializePlayer();
    }
  }, [currentVideo, showVideo]);

  const initializePlayer = () => {
    if (!currentVideo) return;

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
    if (!currentVideo) return;

    if (playerRef.current) {
      try { 
        playerRef.current.destroy(); 
      } catch (e) {
        console.error('Error destroying player:', e);
      }
    }

    const playerDiv = document.getElementById('youtube-player');
    if (!playerDiv) return;

    try {
      playerRef.current = new window.YT.Player('youtube-player', {
        height: showVideo ? '480' : '0',
        width: '100%',
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
            console.log('Player ready');
            playerInitializedRef.current = true;
            if (isPlaying) {
              setTimeout(() => event.target.playVideo(), 200);
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
    if (ignoreNextStateChange.current) return;

    if (event.data === window.YT.PlayerState.PLAYING) {
      if (!isPlaying && socketRef.current) {
        socketRef.current.emit('play-video');
      }
    } else if (event.data === window.YT.PlayerState.PAUSED) {
      if (isPlaying && socketRef.current) {
        socketRef.current.emit('pause-video');
      }
    } else if (event.data === window.YT.PlayerState.ENDED) {
      if (socketRef.current) {
        socketRef.current.emit('next-video');
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
    setShowSearch(false);
  };

  const handleRemoveVideo = (videoId) => {
    if (socketRef.current) {
      socketRef.current.emit('remove-from-playlist', { videoId });
    }
  };

  const toggleVideoVisibility = () => {
    setShowVideo(!showVideo);
    setTimeout(() => {
      if (currentVideo) {
        playerInitializedRef.current = false;
        createPlayer();
      }
    }, 100);
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
      {/* Modern Header */}
      <div className="room-header-modern">
        <div className="room-header-left">
          <div className="room-icon">🎵</div>
          <div>
            <h1 className="room-title-modern">SoulSync Room</h1>
            <div className="room-meta">
              <span className="user-badge">👤 {userName}</span>
              <span className="status-badge">{connectionStatus}</span>
              {currentController && (
                <span className="controller-badge">🎮 {currentController}</span>
              )}
            </div>
          </div>
        </div>
        <div className="room-header-right">
          <div className="user-count-badge">
            👥 {users.length} {users.length === 1 ? 'user' : 'users'}
          </div>
          <button className="btn btn-icon" onClick={() => setShowSearch(true)} title="Search">
            🔍
          </button>
          <button className="btn btn-icon" onClick={copyInviteLink} title="Copy invite">
            📋
          </button>
          <button className="btn btn-icon btn-danger" onClick={() => navigate('/')} title="Leave">
            🚪
          </button>
        </div>
      </div>

      {/* Main Layout */}
      <div className="room-layout">
        {/* Left Column - Video & Playlist */}
        <div className="room-main-content">
          {/* Video Player Section */}
          <div className="video-section">
            {!showVideo && currentVideo && (
              <div className="audio-mode-banner">
                <div className="audio-mode-icon">🎧</div>
                <div className="audio-mode-info">
                  <div className="audio-mode-title">{currentVideo.title}</div>
                  <div className="audio-mode-channel">{currentVideo.channelTitle}</div>
                </div>
                <div className="audio-mode-status">
                  {isPlaying ? '▶️ Playing' : '⏸️ Paused'}
                </div>
              </div>
            )}

            <div className="player-wrapper" style={{ display: showVideo ? 'block' : 'none' }}>
              <div id="youtube-player">
                {!currentVideo && (
                  <div className="player-empty-state">
                    <div className="empty-icon">🎵</div>
                    <div className="empty-title">No video playing</div>
                    <div className="empty-subtitle">Add a video to start listening together!</div>
                  </div>
                )}
              </div>
            </div>

            {/* Quick Controls */}
            <div className="quick-controls">
              <button 
                className="control-btn control-btn-toggle"
                onClick={toggleVideoVisibility}
                disabled={!currentVideo}
              >
                {showVideo ? '🎧 Audio Mode' : '📺 Video Mode'}
              </button>
              
              <div className="playback-controls">
                <button 
                  className="control-btn control-btn-prev"
                  onClick={() => socketRef.current?.emit('next-video')}
                  disabled={playlist.length <= 1}
                  title="Skip"
                >
                  ⏭️
                </button>
              </div>

              <button 
                className="control-btn control-btn-chat"
                onClick={() => setShowChat(!showChat)}
              >
                💬 {showChat ? 'Hide' : 'Show'} Chat
              </button>
            </div>
          </div>

          {/* Add Video Section */}
          <div className="add-video-card">
            <div className="card-header">
              <h3>➕ Add Videos</h3>
            </div>
            <div className="add-video-content">
              <button 
                className="btn btn-primary btn-large"
                onClick={() => setShowSearch(true)}
              >
                🔍 Search YouTube
              </button>
              <div className="divider">
                <span>or</span>
              </div>
              <form onSubmit={addToPlaylist} className="url-input-form">
                <input
                  type="text"
                  placeholder="Paste YouTube URL here..."
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  className="url-input"
                />
                <button 
                  type="submit"
                  className="btn btn-secondary"
                  disabled={!videoUrl.trim()}
                >
                  Add
                </button>
              </form>
            </div>
          </div>

          {/* Playlist */}
          <div className="playlist-card">
            <div className="card-header">
              <h3>🎵 Playlist ({playlist.length})</h3>
            </div>
            <div className="playlist-content">
              {playlist.length === 0 ? (
                <div className="playlist-empty">
                  <div className="empty-icon">🎶</div>
                  <p>Playlist is empty</p>
                  <small>Add videos above to get started</small>
                </div>
              ) : (
                <div className="playlist-items">
                  {playlist.map((video, index) => (
                    <div 
                      key={video.id} 
                      className={`playlist-item-modern ${currentVideo?.id === video.id ? 'is-playing' : ''}`}
                    >
                      <div className="playlist-item-number">
                        {currentVideo?.id === video.id ? (
                          <span className="playing-indicator">
                            {isPlaying ? '▶️' : '⏸️'}
                          </span>
                        ) : (
                          <span>{index + 1}</span>
                        )}
                      </div>
                      
                      <img
                        src={video.thumbnail}
                        alt={video.title}
                        className="playlist-item-thumbnail"
                      />
                      
                      <div className="playlist-item-info">
                        <div className="playlist-item-title">{video.title}</div>
                        <div className="playlist-item-meta">
                          <span>{video.channelTitle}</span>
                          <span className="separator">•</span>
                          <span>Added by {video.addedBy}</span>
                        </div>
                      </div>

                      <button 
                        className="playlist-item-remove"
                        onClick={() => handleRemoveVideo(video.id)}
                        title="Remove from playlist"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column - Chat */}
        {showChat && (
          <div className="chat-panel">
            <div className="chat-header">
              <h3>💬 Chat</h3>
              <button 
                className="btn-icon-small"
                onClick={() => setShowChat(false)}
              >
                ✕
              </button>
            </div>
            
            <div ref={chatContainerRef} className="chat-messages-modern">
              {messages.length === 0 ? (
                <div className="chat-empty">
                  <div className="empty-icon">💬</div>
                  <p>No messages yet</p>
                  <small>Start chatting with your friends!</small>
                </div>
              ) : (
                messages.map((message) => (
                  <div 
                    key={message.id}
                    className={`chat-bubble ${message.type === 'system' ? 'chat-bubble-system' : 'chat-bubble-user'}`}
                  >
                    <div className="chat-bubble-header">
                      <span className="chat-bubble-username">
                        {message.userName}
                      </span>
                      <span className="chat-bubble-time">
                        {new Date(message.timestamp).toLocaleTimeString([], { 
                          hour: '2-digit', 
                          minute: '2-digit' 
                        })}
                      </span>
                    </div>
                    <div className="chat-bubble-text">{message.message}</div>
                  </div>
                ))
              )}
            </div>
            
            <form onSubmit={sendMessage} className="chat-input-modern">
              <input
                type="text"
                placeholder="Type a message..."
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                className="chat-input-field"
                maxLength={500}
              />
              <button 
                type="submit" 
                className="chat-send-btn"
                disabled={!newMessage.trim()}
              >
                ➤
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