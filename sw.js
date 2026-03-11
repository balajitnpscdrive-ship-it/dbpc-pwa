self.addEventListener('install', (e) => {
  console.log('PWA Service Worker Installed');
});

self.addEventListener('fetch', (e) => {
  // Required to be a PWA, even if it just passes through
  e.respondWith(fetch(e.request));
});
