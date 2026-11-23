// Keeps Little World working offline. Always tries the network first so updates arrive,
// and falls back to the saved copy when there's no internet.
const CACHE = 'little-world-v12';
const FILES = ['./', 'index.html', 'app.js', 'style.css', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
// Pip's voice clips are saved too, so she can play with the internet off.
async function saveAll() {
  const c = await caches.open(CACHE);
  await c.addAll(FILES);
  try {
    // The default voice is saved up front; the app downloads any other chosen voice itself.
    const idx = await (await fetch('voice/matilda/index.json')).json();
    await c.addAll(['voice/matilda/index.json', ...Object.values(idx).map(f => 'voice/matilda/' + f)]);
  } catch (e) {}
}
self.addEventListener('install', e => { e.waitUntil(saveAll().then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(res => {
    const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
