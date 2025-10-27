import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import fetch from 'node-fetch';
import { youtubeSearchLimiter, apiLimiter } from './middleware/security.js';

const app = express();
const server = http.createServer(app);

// Trust proxy - Required for Railway and other reverse proxies
app.set('trust proxy', 1);

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
app.use('/api/', apiLimiter);

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const PORT = process.env.PORT || 3001;

const rooms = new Map();
const searchCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000;

function createRoom(roomName, createdBy) {
  const roomId = uuidv4().substring(0, 8);
  const room = {
    id: roomId,
    name: roomName,
    createdBy,
    users: new Map(),
    playlist: [],
    currentVideo: null,
    isPlaying: false,
    currentTime: 0,
    lastUpdate: Date.now(),
    createdAt: new Date(),
    messages: [],
    currentController: null,
  };
  rooms.set(roomId, room);
  return room;
}

function getRoom(roomId) {
  return rooms.get(roomId);
}

function deleteRoom(roomId) {
  rooms.delete(roomId);
}

function getCurrentVideoTime(room) {
  if (!room.isPlaying) {
    return room.currentTime;
  }
  const elapsedSeconds = (Date.now() - room.lastUpdate) / 1000;
  return room.currentTime + elapsedSeconds;
}

// REST API Routes
app.get('/api/rooms', (req, res) => {
  const roomList = Array.from(rooms.values()).map(room => ({
    id: room.id,
    name: room.name,
    userCount: room.users.size,
    currentVideo: room.currentVideo,
    createdBy: room.createdBy,
    createdAt: room.createdAt,
    currentController: room.currentController
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

// YouTube Search
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
      error: 'YouTube search unavailable. Try adding videos by URL.' 
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
        throw new Error('YouTube API quota exceeded.');
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
    res.status(error.message.includes('quota') ? 429 : 500)
       .json({ error: error.message });
  }
});

// Video details
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
    res.json({
      videoId: video.id,
      title: video.snippet.title,
      thumbnail: video.snippet.thumbnails.medium?.url || video.snippet.thumbnails.default?.url,
      channelTitle: video.snippet.channelTitle,
      description: video.snippet.description
    });
  } catch (error) {
    console.error('YouTube video fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch video info' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    youtube: !!YOUTUBE_API_KEY,
    timestamp: new Date().toISOString()
  });
});

app.get('*', (req, res) => {
  res.sendFile('index.html', { root: '../client/dist' });
});

// Socket.io
const io = new Server(server, {
  cors: {
    origin: corsOptions.origin,
    methods: ["GET", "POST"],
    credentials: true
  },
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
    skipMiddlewares: true,
  },
  allowEIO3: true
});

const userRooms = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-room', (data) => {
    const { roomId, userName } = data;
    const room = getRoom(roomId);
    
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    const currentUserRoom = userRooms.get(socket.id);
    if (currentUserRoom === roomId) {
      socket.emit('room-state', {
        playlist: room.playlist,
        currentVideo: room.currentVideo,
        isPlaying: room.isPlaying,
        currentTime: getCurrentVideoTime(room),
        messages: room.messages || [],
        currentController: room.currentController,
        users: Array.from(room.users.values())
      });
      return;
    }

    if (currentUserRoom) {
      const previousRoom = getRoom(currentUserRoom);
      if (previousRoom) {
        previousRoom.users.delete(socket.id);
        socket.leave(currentUserRoom);
        socket.to(currentUserRoom).emit('user-left', { 
          userName: userName, 
          userCount: previousRoom.users.size,
          users: Array.from(previousRoom.users.values())
        });
      }
    }

    room.users.set(socket.id, userName);
    userRooms.set(socket.id, roomId);
    socket.join(roomId);

    socket.emit('room-state', {
      playlist: room.playlist,
      currentVideo: room.currentVideo,
      isPlaying: room.isPlaying,
      currentTime: getCurrentVideoTime(room),
      messages: room.messages || [],
      currentController: room.currentController,
      users: Array.from(room.users.values())
    });

    socket.to(roomId).emit('user-joined', { 
      userName: userName, 
      userCount: room.users.size,
      users: Array.from(room.users.values())
    });
    
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
    console.log(`${userName} joined room ${roomId}`);
  });

  socket.on('add-to-playlist', (data) => {
    const roomId = userRooms.get(socket.id);
    if (!roomId) return;

    const room = getRoom(roomId);
    if (!room) return;

    const userName = room.users.get(socket.id);

    const video = {
      id: uuidv4(),
      videoId: data.videoId,
      title: data.title,
      thumbnail: data.thumbnail,
      channelTitle: data.channelTitle,
      addedBy: userName,
      addedAt: new Date()
    };

    room.playlist.push(video);
    
    if (!room.currentVideo) {
      room.currentVideo = video;
      room.isPlaying = true;
      room.currentTime = 0;
      room.lastUpdate = Date.now();
      room.currentController = userName;
    }

    io.to(roomId).emit('playlist-updated', room.playlist);
    if (room.currentVideo === video) {
      io.to(roomId).emit('video-changed', { 
        video: room.currentVideo, 
        isPlaying: room.isPlaying,
        currentTime: 0,
        controller: room.currentController
      });
    }
  });

  socket.on('play-video', () => {
    const roomId = userRooms.get(socket.id);
    if (!roomId) return;

    const room = getRoom(roomId);
    if (!room) return;

    const userName = room.users.get(socket.id);
    
    room.currentTime = getCurrentVideoTime(room);
    room.isPlaying = true;
    room.lastUpdate = Date.now();
    room.currentController = userName;
    
    // Broadcast to ALL users including sender for perfect sync
    io.to(roomId).emit('video-played', { 
      controller: userName,
      currentTime: room.currentTime 
    });
  });

  socket.on('pause-video', () => {
    const roomId = userRooms.get(socket.id);
    if (!roomId) return;

    const room = getRoom(roomId);
    if (!room) return;

    const userName = room.users.get(socket.id);
    
    room.currentTime = getCurrentVideoTime(room);
    room.isPlaying = false;
    room.lastUpdate = Date.now();
    room.currentController = userName;
    
    // Broadcast to ALL users including sender
    io.to(roomId).emit('video-paused', { 
      controller: userName,
      currentTime: room.currentTime 
    });
  });

  socket.on('seek-video', (data) => {
    const roomId = userRooms.get(socket.id);
    if (!roomId) return;

    const room = getRoom(roomId);
    if (!room) return;

    const userName = room.users.get(socket.id);
    
    room.currentTime = data.time;
    room.lastUpdate = Date.now();
    room.currentController = userName;
    
    // Broadcast to ALL users including sender
    io.to(roomId).emit('video-seeked', { 
      time: data.time,
      controller: userName
    });
  });

  socket.on('next-video', () => {
    const roomId = userRooms.get(socket.id);
    if (!roomId) return;

    const room = getRoom(roomId);
    if (!room || room.playlist.length === 0) return;

    const userName = room.users.get(socket.id);

    if (room.currentVideo) {
      room.playlist = room.playlist.filter(video => video.id !== room.currentVideo.id);
    }

    room.currentVideo = room.playlist[0] || null;
    room.isPlaying = !!room.currentVideo;
    room.currentTime = 0;
    room.lastUpdate = Date.now();
    room.currentController = userName;

    io.to(roomId).emit('playlist-updated', room.playlist);
    io.to(roomId).emit('video-changed', { 
      video: room.currentVideo, 
      isPlaying: room.isPlaying,
      currentTime: 0,
      controller: userName
    });
  });

  socket.on('remove-from-playlist', (data) => {
    const roomId = userRooms.get(socket.id);
    if (!roomId) return;

    const room = getRoom(roomId);
    if (!room) return;

    const { videoId } = data;
    
    // Remove from playlist
    room.playlist = room.playlist.filter(video => video.id !== videoId);
    
    // If current video was removed, play next
    if (room.currentVideo?.id === videoId) {
      room.currentVideo = room.playlist[0] || null;
      room.isPlaying = !!room.currentVideo;
      room.currentTime = 0;
      room.lastUpdate = Date.now();
      
      io.to(roomId).emit('video-changed', { 
        video: room.currentVideo, 
        isPlaying: room.isPlaying,
        currentTime: 0,
        controller: room.users.get(socket.id)
      });
    }
    
    io.to(roomId).emit('playlist-updated', room.playlist);
  });

  // Chat
  socket.on('send-message', (data) => {
    const roomId = userRooms.get(socket.id);
    if (!roomId) return;

    const room = getRoom(roomId);
    if (!room) return;

    const userName = room.users.get(socket.id);

    const message = {
      id: uuidv4(),
      userName: userName,
      message: data.message,
      timestamp: new Date(),
      type: 'user'
    };

    room.messages.push(message);
    if (room.messages.length > 100) {
      room.messages = room.messages.slice(-100);
    }

    io.to(roomId).emit('new-message', message);
  });

  socket.on('disconnect', (reason) => {
    console.log('User disconnected:', socket.id, 'Reason:', reason);
    
    const roomId = userRooms.get(socket.id);
    if (roomId) {
      const room = getRoom(roomId);
      if (room) {
        const userName = room.users.get(socket.id);
        room.users.delete(socket.id);
        
        if (userName) {
          const systemMessage = {
            id: uuidv4(),
            userName: 'System',
            message: `${userName} left the room`,
            timestamp: new Date(),
            type: 'system'
          };
          
          room.messages.push(systemMessage);
          if (room.messages.length > 100) {
            room.messages = room.messages.slice(-100);
          }
          
          socket.to(roomId).emit('new-message', systemMessage);
          socket.to(roomId).emit('user-left', { 
            userName: userName, 
            userCount: room.users.size,
            users: Array.from(room.users.values())
          });
        }

        if (room.users.size === 0) {
          setTimeout(() => {
            const currentRoom = getRoom(roomId);
            if (currentRoom && currentRoom.users.size === 0) {
              console.log(`Deleting empty room: ${roomId}`);
              deleteRoom(roomId);
            }
          }, 60000);
        }
      }
      userRooms.delete(socket.id);
    }
  });
});

server.listen(PORT, () => {
  console.log(`🚀 SoulSync Server running on port ${PORT}`);
  console.log(`🎵 YouTube API: ${YOUTUBE_API_KEY ? '✅ Configured' : '❌ Not configured'}`);
});