// Keeps Little World working offline. Always tries the network first so updates arrive,
// and falls back to the saved copy when there's no internet.
const CACHE = 'little-world-v16';
const FILES = ['./', 'index.html', 'app.js', 'style.css', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
// Pip's default voice clips are saved too, so she can play with the internet off.
async function saveAll() {
  const c = await caches.open(CACHE);
  await c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })));
  try {
    const idx = await (await fetch('voice/matilda/index.json', { cache: 'reload' })).json();
    await c.addAll(['voice/matilda/index.json', ...Object.values(idx).map(f => 'voice/matilda/' + f)]);
  } catch (e) {}
}
self.addEventListener('install', e => { e.waitUntil(saveAll().then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  // Voice clips never change once made: use the saved copy if we have it.
  if (url.pathname.includes('/voice/') && url.pathname.endsWith('.mp3')) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok && res.status === 200) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  e.respondWith(fetch(req, { cache: 'no-cache' }).then(res => {
    // Only save good, complete answers (never an error page from a half-finished update).
    if (res.ok && res.status === 200) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true })
    .then(r => r || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});
