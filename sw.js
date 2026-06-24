// Okinawa 2026 PWA Service Worker
// 版本號:更新內容時改這個數字,使用者下次連網會自動更新快取
const CACHE_NAME = 'okinawa-2026-v1';

// 安裝時要預先快取的核心檔案
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './images/icon-192.png',
  './images/icon-512.png'
];

// 安裝:預快取核心檔案
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('預快取部分失敗(不影響運作):', err))
  );
});

// 啟用:清除舊版快取
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// 攔截請求:採「快取優先,背景更新」策略 (stale-while-revalidate)
// 圖片等靜態資源從快取秒開,同時背景抓最新版更新快取
self.addEventListener('fetch', event => {
  const req = event.request;

  // 只處理 GET 請求;API 即時資料(天氣/匯率)走網路優先
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isAPI = url.hostname.includes('open-meteo.com') ||
                url.hostname.includes('er-api.com') ||
                url.hostname.includes('exchangerate');

  if (isAPI) {
    // API:網路優先,失敗不快取(即時資料不該離線顯示舊值)
    event.respondWith(fetch(req).catch(() => new Response('{}', {headers:{'Content-Type':'application/json'}})));
    return;
  }

  // 同源靜態資源:快取優先 + 背景更新
  event.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req).then(res => {
        // 只快取成功的同源回應
        if (res && res.status === 200 && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
