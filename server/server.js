import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import fetch from 'node-fetch';
import { youtubeSearchLimiter, apiLimiter } from './middleware/security.js';

const app = express();
const server = http.createServer(app);

// CORS configuration for production
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'http://localhost:5173',
      'http://localhost:3000',
      'http://127.0.0.1:5173',
      'https://soulsync-app-production.up.railway.app',
      /\.railway\.app$/
    ];
    
    if (allowedOrigins.some(pattern => 
      typeof pattern === 'string' ? origin === pattern : pattern.test(origin)
    )) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.static('../client/dist'));

// Apply rate limiting
app.use('/api/', apiLimiter);

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const PORT = process.env.PORT || 3001;

// In-memory storage
const rooms = new Map();
const users = new Map();
const searchCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000;

// Enhanced sync system
function startSyncInterval(room) {
  if (room.syncInterval) clearInterval(room.syncInterval);
  
  room.syncInterval = setInterval(() => {
    if (room.users.size > 0 && room.currentVideo && room.isPlaying) {
      // Calculate current time based on playback
      const currentTime = room.currentTime + (Date.now() - room.lastUpdate) / 1000;
      room.currentTime = currentTime;
      room.lastUpdate = Date.now();
      
      // Broadcast sync to all clients every 5 seconds
      io.to(room.id).emit('auto-sync', {
        time: currentTime,
        isPlaying: room.isPlaying,
        videoId: room.currentVideo?.videoId
      });
    }
  }, 5000); // Sync every 5 seconds
}

// Room management
function createRoom(roomName, createdBy) {
  const roomId = uuidv4().substring(0, 8);
  const room = {
    id: roomId,
    name: roomName,
    createdBy,
    users: new Set(),
    playlist: [],
    currentVideo: null,
    isPlaying: false,
    currentTime: 0,
    lastUpdate: Date.now(),
    createdAt: new Date(),
    lastSync: Date.now(),
    syncInterval: null,
    messages: [],
    // Add background playback state
    backgroundPlayback: true
  };
  rooms.set(roomId, room);
  return room;
}

function getRoom(roomId) {
  return rooms.get(roomId);
}

function deleteRoom(roomId) {
  const room = rooms.get(roomId);
  if (room && room.syncInterval) {
    clearInterval(room.syncInterval);
  }
  rooms.delete(roomId);
}

// REST API Routes
app.get('/api/rooms', (req, res) => {
  const roomList = Array.from(rooms.values()).map(room => ({
    id: room.id,
    name: room.name,
    userCount: room.users.size,
    currentVideo: room.currentVideo,
    createdBy: room.createdBy,
    createdAt: room.createdAt
  }));
  res.json(roomList);
});

app.post('/api/rooms', (req, res) => {
  const { roomName, userName } = req.body;
  if (!roomName || !userName) {
    return res.status(400).json({ error: 'Room name and user name required' });
  }
  
  const room = createRoom(roomName, userName);
  res.json({ roomId: room.id, roomName: room.name });
});

// YouTube Search Route
app.get('/api/youtube/search', youtubeSearchLimiter, async (req, res) => {
  const { q, maxResults = 8 } = req.query;
  
  if (!q || q.trim().length === 0) {
    return res.status(400).json({ error: 'Search query is required' });
  }

  const cacheKey = `${q.toLowerCase()}_${maxResults}`;
  const cached = searchCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return res.json(cached.data);
  }

  if (!YOUTUBE_API_KEY) {
    return res.status(503).json({ 
      error: 'YouTube search is temporarily unavailable. Please try adding videos by URL instead.' 
    });
  }

  try {
    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/search?` + new URLSearchParams({
        part: 'snippet',
        type: 'video',
        maxResults: Math.min(parseInt(maxResults), 10),
        q: q.trim(),
        key: YOUTUBE_API_KEY,
        safeSearch: 'moderate'
      })
    );
    
    const data = await response.json();
    
    if (!response.ok) {
      if (response.status === 403) {
        throw new Error('YouTube API quota exceeded. Please try again later.');
      }
      throw new Error(data.error?.message || 'YouTube API error');
    }
    
    if (!data.items) {
      searchCache.set(cacheKey, { data: [], timestamp: Date.now() });
      return res.json([]);
    }
    
    const videos = data.items.map(item => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      description: item.snippet.description,
      thumbnail: item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url,
      channelTitle: item.snippet.channelTitle,
      publishedAt: item.snippet.publishedAt
    }));
    
    searchCache.set(cacheKey, { data: videos, timestamp: Date.now() });
    res.json(videos);
  } catch (error) {
    console.error('YouTube search error:', error);
    
    if (error.message.includes('quota')) {
      res.status(429).json({ error: 'YouTube API quota exceeded. Please try again later.' });
    } else {
      res.status(500).json({ error: 'Search failed: ' + error.message });
    }
  }
});

// Video details endpoint
app.get('/api/youtube/video/:videoId', youtubeSearchLimiter, async (req, res) => {
  const { videoId } = req.params;

  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'Invalid video ID' });
  }

  if (!YOUTUBE_API_KEY) {
    return res.status(503).json({ error: 'YouTube API not configured' });
  }

  try {
    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?` + new URLSearchParams({
        part: 'snippet',
        id: videoId,
        key: YOUTUBE_API_KEY
      })
    );
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error?.message || 'YouTube API error');
    }
    
    if (!data.items || data.items.length === 0) {
      return res.status(404).json({ error: 'Video not found' });
    }
    
    const video = data.items[0];
    const videoInfo = {
      videoId: video.id,
      title: video.snippet.title,
      thumbnail: video.snippet.thumbnails.medium?.url || video.snippet.thumbnails.default?.url,
      channelTitle: video.snippet.channelTitle,
      description: video.snippet.description
    };
    
    res.json(videoInfo);
  } catch (error) {
    console.error('YouTube video fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch video info' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    youtube: !!YOUTUBE_API_KEY,
    timestamp: new Date().toISOString()
  });
});

// Serve client app for all other routes
app.get('*', (req, res) => {
  res.sendFile('index.html', { root: '../client/dist' });
});

// Socket.io
const io = new Server(server, {
  cors: {
    origin: corsOptions.origin,
    methods: ["GET", "POST"]
  }
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-room', (data) => {
    const { roomId, userName } = data;
    const room = getRoom(roomId);
    
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    room.users.add(socket.id);
    users.set(socket.id, { roomId, userName });

    socket.join(roomId);

    // Send room state including chat history
    socket.emit('room-state', {
      playlist: room.playlist,
      currentVideo: room.currentVideo,
      isPlaying: room.isPlaying,
      currentTime: room.currentTime,
      messages: room.messages || [],
      backgroundPlayback: room.backgroundPlayback
    });

    // Start sync interval if not already running and there are users
    if (!room.syncInterval && room.users.size > 0) {
      startSyncInterval(room);
    }

    // Notify others
    socket.to(roomId).emit('user-joined', { userName, userCount: room.users.size });
    
    // Send system message
    const systemMessage = {
      id: uuidv4(),
      userName: 'System',
      message: `${userName} joined the room`,
      timestamp: new Date(),
      type: 'system'
    };
    
    room.messages.push(systemMessage);
    if (room.messages.length > 100) {
      room.messages = room.messages.slice(-100);
    }
    io.to(roomId).emit('new-message', systemMessage);
    
    console.log(`User ${userName} joined room ${roomId}`);
  });

  socket.on('add-to-playlist', (data) => {
    const user = users.get(socket.id);
    if (!user) return;

    const room = getRoom(user.roomId);
    if (!room) return;

    const video = {
      id: uuidv4(),
      videoId: data.videoId,
      title: data.title,
      thumbnail: data.thumbnail,
      channelTitle: data.channelTitle,
      addedBy: user.userName,
      addedAt: new Date()
    };

    room.playlist.push(video);
    
    if (!room.currentVideo) {
      room.currentVideo = video;
      room.isPlaying = true;
      room.currentTime = 0;
      room.lastUpdate = Date.now();
    }

    io.to(user.roomId).emit('playlist-updated', room.playlist);
    if (room.currentVideo === video) {
      io.to(user.roomId).emit('video-changed', { 
        video: room.currentVideo, 
        isPlaying: room.isPlaying 
      });
    }
  });

  socket.on('play-video', () => {
    const user = users.get(socket.id);
    if (!user) return;

    const room = getRoom(user.roomId);
    if (!room) return;

    room.isPlaying = true;
    room.lastUpdate = Date.now();
    
    // Start sync interval if not already running
    if (!room.syncInterval) {
      startSyncInterval(room);
    }
    
    socket.to(user.roomId).emit('video-played');
  });

  socket.on('pause-video', () => {
    const user = users.get(socket.id);
    if (!user) return;

    const room = getRoom(user.roomId);
    if (!room) return;

    room.isPlaying = false;
    room.lastUpdate = Date.now();
    
    socket.to(user.roomId).emit('video-paused');
  });

  socket.on('seek-video', (data) => {
    const user = users.get(socket.id);
    if (!user) return;

    const room = getRoom(user.roomId);
    if (!room) return;

    room.currentTime = data.time;
    room.lastUpdate = Date.now();
    
    socket.to(user.roomId).emit('video-seeked', { time: data.time });
  });

  socket.on('next-video', () => {
    const user = users.get(socket.id);
    if (!user) return;

    const room = getRoom(user.roomId);
    if (!room || room.playlist.length === 0) return;

    if (room.currentVideo) {
      room.playlist = room.playlist.filter(video => video.id !== room.currentVideo.id);
    }

    room.currentVideo = room.playlist[0] || null;
    room.isPlaying = true;
    room.currentTime = 0;
    room.lastUpdate = Date.now();

    io.to(user.roomId).emit('playlist-updated', room.playlist);
    io.to(user.roomId).emit('video-changed', { 
      video: room.currentVideo, 
      isPlaying: room.isPlaying 
    });
  });

  // Enhanced sync system
  socket.on('request-sync', () => {
    const user = users.get(socket.id);
    if (!user) return;

    const room = getRoom(user.roomId);
    if (!room) return;

    let calculatedTime = room.currentTime;
    if (room.isPlaying) {
      calculatedTime += (Date.now() - room.lastUpdate) / 1000;
    }

    socket.emit('sync-response', {
      time: calculatedTime,
      isPlaying: room.isPlaying,
      videoId: room.currentVideo?.videoId
    });
  });

  // Background playback events
  socket.on('toggle-background-playback', (data) => {
    const user = users.get(socket.id);
    if (!user) return;

    const room = getRoom(user.roomId);
    if (!room) return;

    room.backgroundPlayback = data.enabled;
    
    // Broadcast to all room members
    io.to(user.roomId).emit('background-playback-toggled', {
      enabled: room.backgroundPlayback,
      updatedBy: user.userName
    });
  });

  socket.on('toggle-player-visibility', (data) => {
    const user = users.get(socket.id);
    if (!user) return;

    socket.to(user.roomId).emit('player-visibility-changed', {
      visible: data.visible,
      userName: user.userName
    });
  });

  // Chat functionality
  socket.on('send-message', (data) => {
    const user = users.get(socket.id);
    if (!user) return;

    const room = getRoom(user.roomId);
    if (!room) return;

    const message = {
      id: uuidv4(),
      userName: user.userName,
      message: data.message,
      timestamp: new Date(),
      type: 'user'
    };

    // Store message in room (limit to 100 messages)
    room.messages.push(message);
    if (room.messages.length > 100) {
      room.messages = room.messages.slice(-100);
    }

    // Broadcast to all room members
    io.to(user.roomId).emit('new-message', message);
  });

  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      const room = getRoom(user.roomId);
      if (room) {
        room.users.delete(socket.id);
        
        // Send system message
        const systemMessage = {
          id: uuidv4(),
          userName: 'System',
          message: `${user.userName} left the room`,
          timestamp: new Date(),
          type: 'system'
        };
        
        room.messages.push(systemMessage);
        if (room.messages.length > 100) {
          room.messages = room.messages.slice(-100);
        }
        socket.to(user.roomId).emit('new-message', systemMessage);
        
        socket.to(user.roomId).emit('user-left', { 
          userName: user.userName, 
          userCount: room.users.size 
        });

        // Stop sync interval if room is empty
        if (room.users.size === 0 && room.syncInterval) {
          clearInterval(room.syncInterval);
          room.syncInterval = null;
        }
        
        // Delete room if empty for more than 1 minute (optional)
        setTimeout(() => {
          const currentRoom = getRoom(user.roomId);
          if (currentRoom && currentRoom.users.size === 0) {
            deleteRoom(user.roomId);
          }
        }, 60000);
      }
      users.delete(socket.id);
    }
    console.log('User disconnected:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 SoulSync Server running on port ${PORT}`);
  console.log(`🎵 YouTube API: ${YOUTUBE_API_KEY ? '✅ Configured' : '❌ Not configured'}`);
});