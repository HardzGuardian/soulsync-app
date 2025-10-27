import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { roomAPI } from '../services/api.js';

function Home() {
  const [rooms, setRooms] = useState([]);
  const [roomName, setRoomName] = useState('');
  const [userName, setUserName] = useState('');
  const [joinRoomId, setJoinRoomId] = useState('');
  const [joinUserName, setJoinUserName] = useState('');
  const [activeTab, setActiveTab] = useState('create'); // 'create' or 'join'
  const [showRooms, setShowRooms] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
      setJoinRoomId(roomParam);
      setActiveTab('join');
    }

    fetchRooms();
    const interval = setInterval(fetchRooms, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchRooms = async () => {
    try {
      const roomsData = await roomAPI.getRooms();
      setRooms(roomsData);
    } catch (error) {
      console.error('Error fetching rooms:', error);
    }
  };

  const createRoom = async (e) => {
    e.preventDefault();
    if (!roomName.trim() || !userName.trim()) return;

    try {
      const data = await roomAPI.createRoom(roomName, userName);
      navigate(`/room/${data.roomId}`, { state: { userName } });
    } catch (error) {
      console.error('Error creating room:', error);
      alert('Failed to create room: ' + error.message);
    }
  };

  const joinRoom = (e) => {
    e.preventDefault();
    if (!joinRoomId.trim() || !joinUserName.trim()) return;
    navigate(`/room/${joinRoomId}`, { state: { userName: joinUserName } });
  };

  const joinExistingRoom = (roomId) => {
    if (!userName.trim()) {
      alert('Please enter your name first');
      return;
    }
    navigate(`/room/${roomId}`, { state: { userName } });
  };

  return (
    <div className="home-container">
      {/* Hero Section */}
      <div className="hero-section">
        <div className="hero-content">
          <h1 className="hero-title">SoulSync</h1>
          <p className="hero-subtitle">Watch YouTube videos in perfect sync with your friends</p>
          <div className="hero-features">
            <div className="feature-badge">🎵 Real-time Sync</div>
            <div className="feature-badge">💬 Live Chat</div>
            <div className="feature-badge">🎮 Shared Controls</div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="main-content">
        {/* Tab Switcher */}
        <div className="tab-switcher">
          <button 
            className={`tab-button ${activeTab === 'create' ? 'active' : ''}`}
            onClick={() => setActiveTab('create')}
          >
            <span className="tab-icon">➕</span>
            Create Room
          </button>
          <button 
            className={`tab-button ${activeTab === 'join' ? 'active' : ''}`}
            onClick={() => setActiveTab('join')}
          >
            <span className="tab-icon">🔗</span>
            Join Room
          </button>
        </div>

        {/* Forms Container */}
        <div className="forms-container">
          {/* Create Room Form */}
          {activeTab === 'create' && (
            <form onSubmit={createRoom} className="room-form fade-in">
              <div className="form-group">
                <label className="form-label">Your Name</label>
                <input
                  type="text"
                  placeholder="Enter your name"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  className="form-input"
                  required
                  maxLength={20}
                />
              </div>
              
              <div className="form-group">
                <label className="form-label">Room Name</label>
                <input
                  type="text"
                  placeholder="e.g., Movie Night, Chill Vibes"
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  className="form-input"
                  required
                  maxLength={30}
                />
              </div>

              <button type="submit" className="submit-button create-button">
                <span className="button-icon">🎵</span>
                Create Listening Room
              </button>
            </form>
          )}

          {/* Join Room Form */}
          {activeTab === 'join' && (
            <form onSubmit={joinRoom} className="room-form fade-in">
              <div className="form-group">
                <label className="form-label">Your Name</label>
                <input
                  type="text"
                  placeholder="Enter your name"
                  value={joinUserName}
                  onChange={(e) => setJoinUserName(e.target.value)}
                  className="form-input"
                  required
                  maxLength={20}
                />
              </div>
              
              <div className="form-group">
                <label className="form-label">Room ID</label>
                <input
                  type="text"
                  placeholder="Paste room ID here"
                  value={joinRoomId}
                  onChange={(e) => setJoinRoomId(e.target.value)}
                  className="form-input"
                  required
                />
              </div>

              <button type="submit" className="submit-button join-button">
                <span className="button-icon">🔗</span>
                Join Room
              </button>
            </form>
          )}
        </div>

        {/* Active Rooms Section */}
        <div className="active-rooms-section">
          <div className="section-header">
            <h2 className="section-title">
              Active Rooms
              <span className="room-count">{rooms.length}</span>
            </h2>
            <button 
              className="toggle-rooms-btn"
              onClick={() => setShowRooms(!showRooms)}
            >
              {showRooms ? '▼ Hide' : '▶ Show'}
            </button>
          </div>

          {showRooms && (
            <div className="rooms-grid fade-in">
              {rooms.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">🎵</div>
                  <p className="empty-text">No active rooms yet</p>
                  <p className="empty-subtext">Create the first one!</p>
                </div>
              ) : (
                rooms.map(room => (
                  <div 
                    key={room.id} 
                    className="room-card-new"
                    onClick={() => joinExistingRoom(room.id)}
                  >
                    <div className="room-card-header">
                      <h3 className="room-card-title">{room.name}</h3>
                      <span className="room-user-count">
                        👥 {room.userCount}
                      </span>
                    </div>
                    
                    <div className="room-card-body">
                      <p className="room-creator">
                        <span className="creator-icon">👤</span>
                        Created by {room.createdBy}
                      </p>
                      
                      {room.currentVideo && (
                        <div className="room-now-playing">
                          <span className="playing-icon">🎵</span>
                          <span className="playing-text">
                            {room.currentVideo.title}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="room-card-footer">
                      <button className="join-quick-btn">
                        Join Room →
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="home-footer">
        <p>Made with ❤️ for music lovers</p>
      </div>
    </div>
  );
}

export default Home;