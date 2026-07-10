// CACHE v15 — FIX: remove all padding to let iOS handle safe area naturally
const CACHE_NAME = 'cgg-app-cache-v15';
const urlsToCache = [
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];
// ВАЖНО: index.html НЕ кэшируем — всегда берём из сети!

// Подключаем OneSignal SDK Worker
importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.filter(name => name !== CACHE_NAME).map(name => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  var url = event.request.url;

  // === КРИТИЧНО: НЕ трогать cross-origin запросы ===
  // Без этого SW перехватывает навигацию iframe к Google и ломает её
  if (!url.startsWith(self.location.origin)) {
    return; // Браузер обработает сам
  }

  // index.html и навигационные запросы — ВСЕГДА из сети (network-first)
  if (url.includes('index.html') || event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => {
          return caches.match(event.request);
        })
    );
    return;
  }

  // Остальные ресурсы — cache-first
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      if (cachedResponse) return cachedResponse;
      return fetch(event.request).then(networkResponse => {
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, networkResponse.clone());
        });
        return networkResponse;
      });
    })
  );
});

// === ОБРАБОТКА КЛИКА ПО ПУШУ ===
// Перехватываем клик РАНЬШЕ OneSignal и направляем в PWA
self.addEventListener('notificationclick', event => {
  event.notification.close();

  // Извлекаем action и containerId из data-поля пуша
  var action = '';
  var containerId = '';
  var terminalName = '';
  var targetUrl = '';

  if (event.notification.data) {
    action = event.notification.data.action || '';
    containerId = event.notification.data.containerId || '';
    terminalName = event.notification.data.terminalName || '';
    targetUrl = event.notification.data.url || event.notification.data.launchURL || '';
  }

  // Формируем параметры для навигации внутри PWA
  var paramParts = [];
  if (action) paramParts.push('action=' + action);
  if (containerId && action !== 'new' && action !== 'terminal') paramParts.push('c=' + encodeURIComponent(containerId));
  if (action === 'terminal' && terminalName) paramParts.push('t=' + encodeURIComponent(terminalName));

  // Если из data не удалось взять — пробуем из URL
  if (paramParts.length === 0 && targetUrl) {
    try {
      var urlObj = new URL(targetUrl, self.location.origin);
      if (urlObj.search) {
        paramParts.push(urlObj.search.replace('?', ''));
      }
    } catch (e) {
      if (targetUrl.includes('?')) {
        paramParts.push(targetUrl.split('?')[1]);
      }
    }
  }

  // Если ничего не нашли — ставим action=new по умолчанию (безопаснее чем main)
  if (paramParts.length === 0) {
    paramParts.push('action=new');
  }

  var params = '?' + paramParts.join('&');

  // Собираем URL для PWA (всегда наш index.html)
  var appUrl = self.location.origin + self.location.pathname.replace('sw.js', 'index.html') + params;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // Ищем уже открытое окно PWA
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if (client.url.includes('index.html') || client.url.includes('APP-MOP')) {
          // PWA уже открыто — передаём параметры через postMessage
          client.postMessage({ type: 'PUSH_NAVIGATE', params: params });
          return client.focus();
        }
      }
      // PWA не открыто — открываем новое окно
      return clients.openWindow(appUrl);
    })
  );
}, false); // false = наш обработчик первый, до OneSignal
