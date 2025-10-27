// Service Worker for background playback
const CACHE_NAME = 'soulsync-v1';

self.addEventListener('install', (event) => {
  console.log('Service Worker installed');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('Service Worker activated');
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Handle YouTube API requests
  if (event.request.url.includes('youtube.com')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response('Background playback enabled');
      })
    );
  }
});