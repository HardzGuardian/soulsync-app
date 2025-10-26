import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { roomAPI } from '../services/api.js';

function Home() {
  const [rooms, setRooms] = useState([]);
  const [roomName, setRoomName] = useState('');
  const [userName, setUserName] = useState('');
  const [joinRoomId, setJoinRoomId] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
      setJoinRoomId(roomParam);
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
    if (!joinRoomId.trim() || !userName.trim()) return;
    navigate(`/room/${joinRoomId}`, { state: { userName } });
  };

  return (
    <div className="container">
      <div style={{ textAlign: 'center', marginBottom: '60px', padding: '40px 0' }}>
        <h1 style={{ 
          fontSize: '4rem', 
          marginBottom: '16px',
          background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #ec4899 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
          fontWeight: '800'
        }}>
          SoulSync
        </h1>
        <p style={{ fontSize: '1.4rem', color: '#a1a1aa', maxWidth: '500px', margin: '0 auto' }}>
          Watch YouTube videos in perfect sync with your friends
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px', marginTop: '40px' }}>
        <div>
          <h2 style={{ marginBottom: '24px', color: '#f8fafc' }}>Create New Room</h2>
          <form onSubmit={createRoom} style={{ marginTop: '20px' }}>
            <input
              type="text"
              placeholder="Your Name"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              style={{ width: '100%', marginBottom: '16px', padding: '14px' }}
              required
            />
            <input
              type="text"
              placeholder="Room Name"
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              style={{ width: '100%', marginBottom: '20px', padding: '14px' }}
              required
            />
            <button type="submit" className="btn" style={{ width: '100%', padding: '14px' }}>
              🎵 Create Listening Room
            </button>
          </form>
        </div>

        <div>
          <h2 style={{ marginBottom: '24px', color: '#f8fafc' }}>Join Existing Room</h2>
          <form onSubmit={joinRoom} style={{ marginTop: '20px' }}>
            <input
              type="text"
              placeholder="Your Name"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              style={{ width: '100%', marginBottom: '16px', padding: '14px' }}
              required
            />
            <input
              type="text"
              placeholder="Room ID"
              value={joinRoomId}
              onChange={(e) => setJoinRoomId(e.target.value)}
              style={{ width: '100%', marginBottom: '20px', padding: '14px' }}
              required
            />
            <button type="submit" className="btn" style={{ width: '100%', padding: '14px' }}>
              🔗 Join Room
            </button>
          </form>
        </div>
      </div>

      <div style={{ marginTop: '60px' }}>
        <h2 style={{ marginBottom: '24px', color: '#f8fafc' }}>Active Rooms ({rooms.length})</h2>
        <div className="room-grid">
          {rooms.map(room => (
            <div 
              key={room.id} 
              className="room-card"
              onClick={() => {
                if (userName.trim()) {
                  navigate(`/room/${room.id}`, { state: { userName } });
                } else {
                  alert('Please enter your name first');
                }
              }}
            >
              <div className="room-header">
                <h3 style={{ color: '#f8fafc', margin: 0 }}>{room.name}</h3>
                <span className="user-count">{room.userCount} users</span>
              </div>
              <p style={{ color: '#a1a1aa', marginBottom: '8px' }}>Created by: {room.createdBy}</p>
              {room.currentVideo && (
                <p style={{ color: '#6366f1', fontSize: '14px', marginTop: '8px', fontWeight: '500' }}>
                  🎵 Now playing: {room.currentVideo.title}
                </p>
              )}
            </div>
          ))}
        </div>
        {rooms.length === 0 && (
          <p style={{ textAlign: 'center', color: '#a1a1aa', marginTop: '40px', fontSize: '16px' }}>
            No active rooms. Create one to get started!
          </p>
        )}
      </div>
    </div>
  );
}

export default Home;