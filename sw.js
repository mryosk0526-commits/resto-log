/* 食べ歩きメモ — Service Worker
   方針: ネット優先(network-first)。オンラインなら常に最新を配信し、
   オフラインのときだけキャッシュにフォールバック（＝更新が必ず届く）。
   データ本体は IndexedDB 側にあり、ここではアプリ本体のみ扱う。 */
const CACHE = 'resto-log-v13';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const sameOrigin = new URL(request.url).origin === location.origin;
  if (!sameOrigin) return; // 外部リソースは素通り

  // ネット優先: まず取りに行き、成功したらキャッシュも更新。失敗時のみキャッシュを返す
  e.respondWith(
    fetch(request)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match('./index.html')))
  );
});
