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
  
  const playerRef = useRef(null);
  const chatContainerRef = useRef(null);
  const hasJoinedRef = useRef(false);

  // Setup socket connection with proper reconnection handling
  useEffect(() => {
    if (!userName) {
      navigate('/');
      return;
    }

    // Prevent multiple socket connections
    if (socket) {
      return;
    }

    const socketUrl = import.meta.env.MODE === 'development' 
      ? 'http://localhost:3001' 
      : window.location.origin;

    console.log('Connecting to socket:', socketUrl);

    const newSocket = io(socketUrl, {
      // Proper socket configuration to prevent reconnection spam
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
      
      // Only join room once on initial connection
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
    });

    newSocket.on('playlist-updated', (updatedPlaylist) => {
      setPlaylist(updatedPlaylist);
    });
    
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

    // Chat events
    newSocket.on('new-message', (message) => {
      setMessages(prev => [...prev, message]);
    });

    newSocket.on('user-joined', ({ userName: joinedUser, userCount }) => {
      console.log(`${joinedUser} joined the room`);
      // Only show system message if it's not the current user
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
      console.log(`${leftUser} left the room`);
      // Only show system message if it's not the current user
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
  }, [currentVideo]);

  const initializePlayer = () => {
    if (!currentVideo) return;

    playerRef.current = new window.YT.Player('youtube-player', {
      height: '400',
      width: '100%',
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
    console.log('YouTube player ready');
    if (isPlaying) {
      event.target.playVideo();
    }
  };

  const onPlayerStateChange = (event) => {
    // Update play/pause state based on player events
    if (event.data === window.YT.PlayerState.PLAYING) {
      setIsPlaying(true);
    } else if (event.data === window.YT.PlayerState.PAUSED) {
      setIsPlaying(false);
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
    if (socket && playerRef.current) {
      socket.emit('play-video');
      playerRef.current.playVideo();
      setIsPlaying(true);
    }
  };

  const handlePause = () => {
    if (socket && playerRef.current) {
      socket.emit('pause-video');
      playerRef.current.pauseVideo();
      setIsPlaying(false);
    }
  };

  const handleNext = () => {
    if (socket) {
      socket.emit('next-video');
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
            <span className="sync-status"> {syncStatus}</span>
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
          {/* Player Container */}
          <div className="player-container">
            <div id="youtube-player">
              {!currentVideo && (
                <div style={{ 
                  height: '400px', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  background: 'rgba(255, 255, 255, 0.02)',
                  color: '#a1a1aa',
                  fontSize: '18px',
                  flexDirection: 'column',
                  gap: '16px'
                }}>
                  <div style={{ fontSize: '48px' }}>🎵</div>
                  <div>No video playing. Add a video to get started!</div>
                </div>
              )}
            </div>
          </div>

          {/* Controls with proper play/pause state */}
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

      <YouTubeSearch
        onAddToPlaylist={handleAddFromSearch}
        isOpen={showSearch}
        onClose={() => setShowSearch(false)}
      />
    </div>
  );
}

export default Room;