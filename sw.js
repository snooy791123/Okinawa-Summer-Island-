// Okinawa 2026 PWA Service Worker
// 版本號:更新內容時改這個數字,使用者下次連網會自動更新快取（core 與 runtime 一起 bump）
const SW_VERSION = 'v2';
const CORE_CACHE = `okinawa-2026-core-${SW_VERSION}`;
const RUNTIME_CACHE = `okinawa-2026-runtime-${SW_VERSION}`;

// runtime cache（主要是 images/ 底下 177 張圖）數量上限，超過時淘汰最舊的項目
// 避免裝置儲存空間隨著瀏覽頁面無限成長
const MAX_RUNTIME_ENTRIES = 160;

// 安裝時要預先快取的核心檔案：只放最關鍵的少量檔案，
// 173 張圖片一律「按需快取」（使用者實際瀏覽到該頁面/店家時才存入 runtime cache），
// 而非全部預載，藉此加快 PWA 首次安裝與開啟速度。
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
    caches.open(CORE_CACHE)
      .then(cache => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('預快取部分失敗(不影響運作):', err))
  );
});

// 啟用:清除舊版快取（core、runtime 只要版本號不符就整包刪除）
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CORE_CACHE && k !== RUNTIME_CACHE).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// 接收頁面端訊息：允許使用者點擊「立即更新」時跳過等待、直接接管
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// 修剪 runtime cache：超過上限時，刪除最舊存入的項目（近似 LRU 的簡易 FIFO 淘汰）
async function trimRuntimeCache() {
  const cache = await caches.open(RUNTIME_CACHE);
  const keys = await cache.keys();
  if (keys.length > MAX_RUNTIME_ENTRIES) {
    const excess = keys.length - MAX_RUNTIME_ENTRIES;
    for (let i = 0; i < excess; i++) {
      await cache.delete(keys[i]);
    }
  }
}

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

  // 同源圖片走 runtime cache（按需存入 + 數量上限），其餘同源資源走 core cache
  const isImage = url.origin === self.location.origin && /\/images\//.test(url.pathname);
  const targetCacheName = isImage ? RUNTIME_CACHE : CORE_CACHE;

  event.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req).then(res => {
        // 只快取成功的同源回應
        if (res && res.status === 200 && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(targetCacheName).then(cache => {
            cache.put(req, copy);
            if (isImage) trimRuntimeCache();
          });
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
