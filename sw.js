// AlphaChart AI - Institutional PWA Service Worker (Mobile & Desktop)
const CACHE_NAME = 'alphachart-pwa-v8';
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/styles.css',
  '/js/auth.js',
  '/js/app.js',
  '/js/trend_trader.js',
  '/js/scanner.js',
  '/js/journal.js',
  '/js/news.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/icon.svg',
  '/favicon.png'
];

// 1. INSTALL: Pre-cache essential app shell assets
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('[AlphaChart PWA] Precache warning:', err);
      });
    })
  );
});

// 2. ACTIVATE: Clean up stale caches & claim clients immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            console.log('[AlphaChart PWA] Purging outdated cache:', name);
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. FETCH: Network-First with Cache Fallback (Bypasses external live streaming)
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Skip WebSocket connections and external high-frequency Binance streaming
  if (url.protocol === 'ws:' || url.protocol === 'wss:' || url.hostname.includes('binance.com') || url.hostname.includes('binance.vision')) {
    return;
  }

  // Only handle GET requests
  if (req.method !== 'GET') return;

  event.respondWith(
    fetch(req)
      .then((networkRes) => {
        // Cache valid local static responses
        if (networkRes && networkRes.status === 200 && (url.origin === self.location.origin)) {
          const resClone = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        }
        return networkRes;
      })
      .catch(() => {
        // Offline Fallback: Serve from cache
        return caches.match(req).then((cachedRes) => {
          if (cachedRes) return cachedRes;
          if (req.mode === 'navigate') {
            return caches.match('/index.html');
          }
          return new Response('Offline', { status: 503, statusText: 'Offline' });
        });
      })
  );
});

// 4. BACKGROUND PUSH: Native Lockscreen Push for iOS & Android
self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { body: event.data.text() };
    }
  }

  const title = data.title || 'AlphaChart AI Signal Alert';
  const options = {
    body: data.body || 'A new confirmed BUY/SELL signal just closed!',
    icon: data.icon || '/icons/icon-192.png',
    badge: data.badge || '/icons/icon-192.png',
    tag: data.tag || `alphachart-signal-${Date.now()}`,
    vibrate: [300, 100, 300, 100, 400],
    renotify: true,
    requireInteraction: true,
    data: {
      url: data.url || '/',
      signal: data.signal || null
    },
    actions: [
      { action: 'open', title: '📊 View Chart' },
      { action: 'dismiss', title: 'Dismiss' }
    ]
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// 5. NOTIFICATION CLICK: Focus existing window or open PWA standalone
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) ? event.notification.data.url : '/';

  if (event.action === 'dismiss') {
    return;
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url && 'focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
