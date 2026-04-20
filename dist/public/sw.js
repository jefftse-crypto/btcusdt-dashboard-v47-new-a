const CACHE_NAME = 'crypto-analyst-v1';
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

// 安裝：預先快取靜態資源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// 啟動：清除舊版快取
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// 攔截請求：Network First 策略（優先網路，離線時用快取）
self.addEventListener('fetch', (event) => {
  // 只處理 GET 請求
  if (event.request.method !== 'GET') return;

  // API 請求與 WebSocket 不快取
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // 成功時更新快取
        if (response.ok) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // 網路失敗時從快取回應
        return caches.match(event.request).then((cached) => {
          return cached || caches.match('/');
        });
      })
  );
});
