const getApiBaseUrl = () => {
  if (import.meta.env.MODE === 'development') {
    return 'http://localhost:3001';
  } else {
    return '';
  }
};

export const API_BASE_URL = getApiBaseUrl();

export const apiFetch = async (endpoint, options = {}) => {
  const url = `${API_BASE_URL}${endpoint}`;
  
  try {
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Network error' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('API fetch error:', error);
    throw error;
  }
};

export const youtubeAPI = {
  search: (query, maxResults = 8) => 
    apiFetch(`/api/youtube/search?q=${encodeURIComponent(query)}&maxResults=${maxResults}`),
  
  getVideoInfo: (videoId) =>
    apiFetch(`/api/youtube/video/${videoId}`),
};

export const roomAPI = {
  getRooms: () => apiFetch('/api/rooms'),
  
  createRoom: (roomName, userName) =>
    apiFetch('/api/rooms', {
      method: 'POST',
      body: JSON.stringify({ roomName, userName }),
    }),
};