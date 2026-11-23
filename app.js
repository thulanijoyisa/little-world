'use strict';
// If anything goes wrong, show it in the window title so it can be diagnosed instead of a blank screen.
window.addEventListener('error', e => { document.title = 'LW-ERR ' + e.message + ' @' + (e.lineno || ''); });
window.addEventListener('unhandledrejection', e => { document.title = 'LW-ERR ' + ((e.reason && (e.reason.stack || e.reason.message)) || e.reason); });
/* Little World: a toddler play-and-talk app with Pip, a friend who listens.
   Everything (photos, voices, her recordings) is stored only in this browser on this device. */

// ---------------- helpers ----------------
const $ = s => document.querySelector(s);
const wait = ms => new Promise(r => setTimeout(r, ms));
const pick = a => a[Math.floor(Math.random() * a.length)];
const rand = (a, b) => a + Math.random() * (b - a);
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
// Screen state lives up here because the voice loader can run before the rest of the file.
const SCREENS = {};
let cur = null, sessionStart = null, lastInput = 0;
const COLORS = ['#ff6b6b', '#ffa94d', '#fcc419', '#51cf66', '#20c997', '#339af0', '#845ef7', '#f06595'];

function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'value') e.value = v;
    else if (k === 'checked') e.checked = !!v;
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) { if (c == null || c === false) continue; e.append(c instanceof Node ? c : document.createTextNode(c)); }
  return e;
}

// ---------------- storage (IndexedDB) ----------------
let db;
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('littleworld', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('blobs'); };
    r.onsuccess = () => { db = r.result; db.onclose = () => { db = null; }; res(); };
    r.onerror = () => rej(r.error);
  });
}
function tx1(store, mode, fn) {
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode); const r = fn(t.objectStore(store));
    t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('aborted'));
  });
}
// iPhones sometimes drop the storage connection after the app was in the background: reopen once and retry.
async function tx(store, mode, fn) {
  try { if (!db) await openDB(); return await tx1(store, mode, fn); }
  catch (e) { if (e && e.name === 'QuotaExceededError') throw e; await openDB(); return tx1(store, mode, fn); }
}
const kvGet = k => tx('kv', 'readonly', s => s.get(k));
const kvSet = (k, v) => tx('kv', 'readwrite', s => s.put(v, k));
const blobGet = k => tx('blobs', 'readonly', s => s.get(k));
const blobSet = (k, v) => tx('blobs', 'readwrite', s => s.put(v, k));
const blobDel = k => k ? tx('blobs', 'readwrite', s => s.delete(k)) : null;
const urlCache = {};
async function blobURL(id) {
  if (!id) return null;
  if (urlCache[id]) return urlCache[id];
  const b = await blobGet(id);
  return b ? (urlCache[id] = URL.createObjectURL(b)) : null;
}

const STARTER = [
  ['Mama', '👩'], ['Daddy', '👨'], ['Gogo', '👵'], ['Baby', '👶'], ['Dog', '🐶'], ['Cat', '🐱'],
  ['Ball', '⚽'], ['Cup', '🥤'], ['Shoes', '👟'], ['Car', '🚗'], ['Water', '💧'], ['Milk', '🥛'],
  ['Banana', '🍌'], ['Book', '📖'], ['Bird', '🐦'], ['Cow', '🐄'], ['Sun', '☀️'], ['Moon', '🌙'],
  ['Hat', '👒'], ['Bath', '🛁'], ['Teddy', '🧸'], ['Duck', '🦆'],
];
// Animal sounds, said after the animal's name: "Duck! Quack quack!"
const SOUNDS = {
  dog: 'Woof woof!', puppy: 'Woof woof!', cat: 'Meow!', kitty: 'Meow!', cow: 'Moo!', duck: 'Quack quack!',
  bird: 'Tweet tweet!', chicken: 'Cluck cluck!', hen: 'Cluck cluck!', frog: 'Ribbit!', lion: 'Roar!',
  elephant: 'Toot toot!', sheep: 'Baa baa!', pig: 'Oink oink!', horse: 'Neigh!', goat: 'Meh meh!',
  owl: 'Hoo hoo!', bee: 'Buzz buzz!', snake: 'Hiss!', monkey: 'Ooh ooh ah ah!', mouse: 'Squeak squeak!',
  car: 'Beep beep!', train: 'Choo choo!', baby: 'Waa waa!', bear: 'Grr!',
};
const soundOf = t => t && !t.self && SOUNDS[(t.en || '').trim().toLowerCase()];
const ANIMALS = [['🐶', 'Dog'], ['🐱', 'Cat'], ['🐮', 'Cow'], ['🐔', 'Chicken'], ['🐦', 'Bird'], ['🐸', 'Frog'], ['🐘', 'Elephant'], ['🦁', 'Lion']];
// Every game on the home screen. Little mode shows only a few, so she isn't faced with too many choices.
const GAMES = [['talk', 'pip', 'Talk with Pip'], ['family', '👨‍👩‍👧', 'Family peekaboo'], ['peekaboo', '🙈', 'Peekaboo'], ['body', '👃', 'My body'],
  ['feed', '🐵', 'Feed the animals'], ['songs', '🎵', 'Songs'], ['bubbles', '🫧', 'Bubbles'], ['copy', '🦜', 'Copy me!'], ['hiding', '🌳', "Who's hiding?"],
  ['words', '🗣️', 'My Words'], ['colours', '🌈', 'Colours'], ['numbers', '🔢', 'Counting'], ['paint', '🎨', 'Paint'], ['piano', '🐮', 'Animals']];
const LITTLE = ['talk', 'family', 'peekaboo', 'body', 'feed', 'songs', 'bubbles'];
const NOTES = [262, 294, 330, 349, 392, 440, 494, 523];

function defaults() {
  return {
    name: '', photo: null, birthday: '', nameRec: [], bdayRec: [], minutes: 15, listen: true, voice: '',
    words: STARTER.map(([en, emoji]) => ({ id: uid(), en, emoji, photo: null, rec: { en: [] } })),
    herClips: [], keepVoice: true, countTo: 5, pipVoice: 'matilda', setupDone: false, show: LITTLE.slice(), songRec: {},
  };
}
// Older saves had isiZulu fields; keep only what the English app uses.
function tidy(s) {
  s.words = (s.words || []).map(w => ({ id: w.id || uid(), en: w.en || '', emoji: w.emoji || '⭐', photo: w.photo || null, rec: { en: (w.rec && w.rec.en) || [] } }));
  s.herClips = s.herClips || [];
  if (!Array.isArray(s.show)) s.show = LITTLE.slice();
  if (!s.songRec || typeof s.songRec !== 'object') s.songRec = {};
  for (const k of ['diary', 'gallery', 'who']) delete s[k];
  return s;
}
let S;
const save = () => kvSet('settings', S);
const herName = () => S.name || 'sweetheart';

// ---------------- sound ----------------
let AC, sfxUntil = 0, audioUnlocked = false;
function ac() {
  if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
  if (AC.state !== 'running' && AC.state !== 'closed') AC.resume().catch(() => {});
  return AC;
}
// iPhone and iPad only allow sound after a real tap (touchend/click), and mute web sound when the
// silent switch is on unless the page says it is "playback" audio. Do both on every tap until sound
// is running (iOS can also pause sound after a call or when the app was in the background).
function setAudioSession(type) { try { if (navigator.audioSession) navigator.audioSession.type = type; } catch (e) {} }
function unlockAudio() {
  if (!micStream) setAudioSession('playback');
  const a = ac();
  try { const b = a.createBuffer(1, 1, 22050), src = a.createBufferSource(); src.buffer = b; src.connect(a.destination); src.start(0); } catch (e) {}
  if (!audioUnlocked && window.speechSynthesis) {
    try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch (e) {}
  }
  if (a.state === 'running') audioUnlocked = true;
}
for (const ev of ['touchend', 'click', 'keydown', 'pointerup']) {
  document.addEventListener(ev, () => { if (!audioUnlocked || !AC || AC.state !== 'running') unlockAudio(); }, { capture: true, passive: true });
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (typeof ear !== 'undefined') ear.stop(); return; } // give the microphone back while away
  if (AC) { audioUnlocked = false; ac(); }
});
function tone(freq, dur = 0.25, type = 'sine', vol = 0.25) {
  const a = ac(), o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, a.currentTime); g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
  o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + dur);
  sfxUntil = Math.max(sfxUntil, Date.now() + dur * 1000 + 150);
}
function slide(from, to, dur = 0.35, vol = 0.2) {
  const a = ac(), o = a.createOscillator(), g = a.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(from, a.currentTime); o.frequency.exponentialRampToValueAtTime(to, a.currentTime + dur);
  g.gain.setValueAtTime(vol, a.currentTime); g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
  o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + dur); sfxUntil = Math.max(sfxUntil, Date.now() + dur * 1000 + 150);
}
const sfx = {
  pop() { tone(rand(600, 1000), 0.12, 'sine', 0.3); },
  soft() { tone(330, 0.3, 'sine', 0.15); },
  tada() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.35, 'triangle'), i * 110)); },
  peek() { slide(300, 1100, 0.3); setTimeout(() => [988, 1175, 988, 1319].forEach((f, i) => setTimeout(() => tone(f, 0.09, 'triangle', 0.18), i * 85)), 280); },
  hide() { slide(700, 220, 0.35, 0.15); },
  whoosh() { slide(200, 1600, 0.5, 0.06); },
  boing() { slide(180, 520, 0.25, 0.25); },
};

// Speech: recorded family voices first, the computer's voice as a fallback.
let voices = [];
function loadVoices() {
  const had = voices.length;
  voices = window.speechSynthesis ? speechSynthesis.getVoices() : [];
  // Chrome lists voices a moment after start-up; refresh the voice picker if it was already showing.
  const sel = !had && voices.length && document.getElementById('robot-voice');
  if (sel) { sel.innerHTML = ''; sel.append(h('option', { value: '' }, `Automatic (${(pickVoiceAuto() || {}).name || 'default'})`),
    ...niceVoices().map(v => h('option', { value: v.name, selected: v.name === S.voice }, `${v.name}${v.localService ? '' : ' (internet)'}`))); }
}
if (window.speechSynthesis) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
// Joke voices that come with macOS; never offer these.
const SILLY = /Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Wobble|Fred|Good News|Jester|Junior|Organ|Superstar|Ralph|Trinoids|Whisper|Zarvox|Rocko|Grandpa|Eddy|Reed/i;
function niceVoices() { return voices.filter(v => /^en/i.test(v.lang) && !SILLY.test(v.name)); }
// Most natural first: Chrome's Google voices, then Apple's best ones.
const PREFER = [/Google UK English Female/, /Google US English/, /Premium/, /Enhanced/, /^Samantha/, /^Flo.*(UK|Kingdom)/, /^Shelley.*(UK|Kingdom)/, /^Karen/, /^Moira/, /^Daniel/, /^Tessa/];
function pickVoice() {
  const nice = niceVoices();
  const chosen = S && S.voice && nice.find(v => v.name === S.voice);
  return chosen || pickVoiceAuto();
}
function pickVoiceAuto() {
  const nice = niceVoices();
  for (const re of PREFER) { const v = nice.find(v => re.test(v.name)); if (v) return v; }
  return nice[0];
}
// The computer's own voice: only a last resort now (e.g. a word a family typed but never recorded).
function robotTTS(text, pitch = 1) {
  return new Promise(res => {
    if (!window.speechSynthesis || !text) return res();
    stopVoice();
    const wasBusy = speechSynthesis.speaking || speechSynthesis.pending;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text), v = pickVoice();
    if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = 0.9; u.pitch = pitch;
    let done = false; const fin = () => { if (!done) { done = true; res(); } };
    u.onend = fin; u.onerror = fin; setTimeout(fin, 4500);
    if (wasBusy) setTimeout(() => speechSynthesis.speak(u), 60); else speechSynthesis.speak(u);
  });
}

// ---------------- Pip's natural voice (recorded clips in voice/) ----------------
// voice/index.json maps a phrase ("where's", "duck", "quack quack") to its audio file.
// Sentences are built from clips: "Where's Duck?" plays "where's" then "duck".
const norm = s => String(s).toLowerCase().replace(/’/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
const PIP_VOICES = [['matilda', 'Matilda', 'warm and friendly'], ['jessica', 'Jessica', 'bright and playful'],
  ['lily', 'Lily', 'soft, British accent'], ['sarah', 'Sarah', 'gentle and soft']];
let VOICE = {}, voiceName = '', voiceReady = Promise.resolve(), bufCache = {};
// Loads the chosen voice's list of clips, then quietly downloads them all so they also work offline.
function loadVoice(name) {
  if (!PIP_VOICES.some(v => v[0] === name)) name = PIP_VOICES[0][0];
  if (name === voiceName) return voiceReady;
  voiceName = name; bufCache = {}; VOICE = {};
  voiceReady = fetch(`voice/${name}/index.json`).then(r => r.ok ? r.json() : {}).then(j => {
    if (voiceName !== name) return;
    VOICE = j || {};
    setTimeout(() => Object.values(VOICE).forEach(f => fetch(`voice/${name}/${f}`).catch(() => {})), 3000);
  }).catch(() => {});
  return voiceReady;
}
function trimSilence(b) {
  const d = b.getChannelData(0), thr = 0.012;
  let st = 0, en = d.length - 1;
  while (st < en && Math.abs(d[st]) < thr) st++;
  while (en > st && Math.abs(d[en]) < thr) en--;
  const pad = Math.floor(b.sampleRate * 0.03);
  st = Math.max(0, st - pad); en = Math.min(d.length - 1, en + pad);
  const out = ac().createBuffer(b.numberOfChannels, en - st + 1, b.sampleRate);
  for (let c = 0; c < b.numberOfChannels; c++) out.copyToChannel(b.getChannelData(c).subarray(st, en + 1), c);
  return out;
}
function clipBuf(key) {
  if (!bufCache[key]) bufCache[key] = fetch(`voice/${voiceName}/${VOICE[key]}`).then(r => r.arrayBuffer())
    .then(decodeAudio).then(trimSilence).catch(() => { delete bufCache[key]; return null; });
  return bufCache[key];
}
// Finds clips covering the whole sentence, longest phrases first. Null if any part has no clip.
function clipPlan(text) {
  const toks = norm(text).split(' ').filter(Boolean), keys = [];
  for (let i = 0; i < toks.length;) {
    let n = Math.min(7, toks.length - i);
    for (; n > 0; n--) { const k = toks.slice(i, i + n).join(' '); if (VOICE[k]) { keys.push(k); break; } }
    if (!n) return null;
    i += n;
  }
  return keys.length ? keys : null;
}
let voiceSources = [], voiceUntil = 0, voiceGen = 0;
function stopVoice() {
  voiceGen++; voiceUntil = 0;
  for (const src of voiceSources) { try { src.stop(); } catch (e) {} }
  voiceSources = [];
}
// Plays decoded sounds one after another through Web Audio (the path iPhone/iPad handle reliably).
async function playBuffers(bufs, rate = 1, gap = 0.06) {
  stopVoice();
  const gen = voiceGen, a = ac();
  if (a.state !== 'running') { await Promise.race([a.resume().catch(() => {}), wait(300)]); if (gen !== voiceGen) return true; }
  let t = a.currentTime + 0.03;
  for (const b of bufs) {
    const src = a.createBufferSource(); src.buffer = b; src.playbackRate.value = rate; src.connect(a.destination); src.start(t);
    voiceSources.push(src); src.onended = () => { voiceSources = voiceSources.filter(x => x !== src); };
    t += b.duration / rate + gap;
  }
  const end = Date.now() + (t - a.currentTime) * 1000;
  voiceUntil = end;
  await new Promise(r => { const tick = () => (gen !== voiceGen || Date.now() >= end) ? r() : setTimeout(tick, 40); tick(); });
  return true;
}
async function playClips(keys) {
  const gen = ++voiceGen;
  const bufs = await Promise.all(keys.map(clipBuf));
  if (gen !== voiceGen) return true; // something newer started speaking
  if (bufs.some(b => !b)) return false;
  return playBuffers(bufs);
}
// Everything Pip says goes through here: natural clips when we have them, the computer voice otherwise.
async function tts(text, pitch = 1) {
  if (!text) return;
  await voiceReady;
  const plan = clipPlan(text);
  if (plan) {
    if (window.speechSynthesis) speechSynthesis.cancel();
    if (await playClips(plan)) return;
  }
  return robotTTS(text, pitch);
}
// Family recordings and her own voice: decoded and played through Web Audio too.
const decoded = new Map();
function decodeAudio(ab) {
  const a = ac();
  return new Promise((res, rej) => { const p = a.decodeAudioData(ab, res, rej); if (p && p.then) p.then(res, rej); });
}
async function playURL(url, rate = 1) {
  if (!url) return false;
  try {
    let buf = decoded.get(url);
    if (!buf) {
      const gen = ++voiceGen;
      buf = await decodeAudio(await (await fetch(url)).arrayBuffer());
      if (gen !== voiceGen) return true;
      decoded.set(url, buf); if (decoded.size > 40) decoded.delete(decoded.keys().next().value);
    }
    if (window.speechSynthesis) speechSynthesis.cancel();
    return await playBuffers([buf], rate, 0);
  } catch (e) {
    return playElement(url, rate); // e.g. a recording format this device can't decode
  }
}
let curAudio = null;
function playElement(url, rate = 1) {
  return new Promise(res => {
    stopVoice();
    if (curAudio) curAudio.pause();
    const a = new Audio(url); curAudio = a;
    if (rate !== 1) { a.preservesPitch = false; a.playbackRate = rate; }
    let done = false; const fin = v => { if (!done) { done = true; res(v); } };
    a.onended = () => fin(true); a.onerror = () => fin(false); a.onpause = () => fin(true);
    a.play().catch(() => fin(false)); setTimeout(() => fin(true), 9000);
  });
}
async function playBlob(id, rate) { return playURL(await blobURL(id), rate); }
function stopSound() { stopVoice(); if (curAudio) curAudio.pause(); if (window.speechSynthesis) speechSynthesis.cancel(); }
const speaking = () => Date.now() < voiceUntil || (curAudio && !curAudio.paused && !curAudio.ended) || (window.speechSynthesis && speechSynthesis.speaking);
function appTalking() { return speaking() || Date.now() < sfxUntil; }
async function sayWord(w) {
  const recs = w.rec.en;
  if (recs.length && await playBlob(pick(recs).id)) return;
  await tts(w.en);
}
async function sayName() { if (S.nameRec.length && await playBlob(pick(S.nameRec))) return; await tts(herName()); }

// "Things" are her words plus herself, used by the games.
const SELF = { self: true };
const thingName = t => t.self ? herName() : t.en;
const hasRec = t => t.self ? S.nameRec.length > 0 : t.rec.en.length > 0;
const sayThing = t => t.self ? sayName() : sayWord(t);
// Says "Where's Mama?" in one natural sentence, or around the family recording when there is one.
async function sayAround(before, t, after = '') {
  if (!hasRec(t)) await tts(`${before} ${thingName(t)}${after}`.trim());
  else {
    if (before) await tts(before);
    await sayThing(t);
    if (after.replace(/^[?!.,]\s*/, '')) await tts(after.replace(/^[?!.,]\s*/, ''));
  }
}
// The thing's name, then its sound if it has one: "Duck! Quack quack!"
async function sayWithSound(before, t) {
  await sayAround(before, t, '!');
  const s = soundOf(t);
  if (s) { await wait(150); await tts(s, 1.15); }
}
async function thingPic(t) { return t.self ? faceEl() : pictureEl(t); }
// Family peekaboo uses only the real photos: her own face and any word with a photo.
const photoThings = () => [...(S.photo ? [SELF] : []), ...S.words.filter(w => w.en && w.photo)];
function thingDeck(pool = () => [SELF, ...S.words.filter(w => w.en)]) {
  let order = [], i = 0;
  return () => {
    if (i >= order.length) { order = shuffle(pool()); i = 0; }
    return order[i++];
  };
}

// ---------------- microphone: the ear that listens to her ----------------
let micStream = null;
async function getMic() {
  if (micStream && micStream.active) return micStream;
  setAudioSession('play-and-record');
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (e) { setAudioSession('playback'); throw e; }
  return micStream;
}
// Turns captured sound into a small WAV file, made louder so a quiet little voice plays back clearly.
function toWav(chunks, rate) {
  const n = chunks.reduce((a, c) => a + c.length, 0), all = new Float32Array(n);
  let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
  let data = all, r = rate;
  if (rate >= 44100) { data = new Float32Array(n >> 1); for (let i = 0; i < data.length; i++) data[i] = (all[2 * i] + all[2 * i + 1]) / 2; r = Math.round(rate / 2); }
  let peak = 0; for (const x of data) peak = Math.max(peak, Math.abs(x));
  const g = peak > 0 ? Math.min(5, 0.9 / peak) : 1;
  const buf = new ArrayBuffer(44 + data.length * 2), v = new DataView(buf);
  const w = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + data.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, r, true);
  v.setUint32(28, r * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, data.length * 2, true);
  for (let i = 0; i < data.length; i++) { const s = Math.max(-1, Math.min(1, data[i] * g)); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return new Blob([buf], { type: 'audio/wav' });
}
const ear = {
  ready: false, level: 0, floor: 0.01, pre: [], job: null, rate: 48000, starting: null,
  start() {
    if (this.ready && micStream && micStream.active) return Promise.resolve(true);
    if (this.ready) this.stop(); // the microphone died (e.g. the iPhone app went to the background)
    if (!this.starting) this.starting = (async () => {
      try {
        const st = await getMic(), a = ac(); this.rate = a.sampleRate;
        const src = a.createMediaStreamSource(st), node = a.createScriptProcessor(2048, 1, 1), mute = a.createGain();
        mute.gain.value = 0; src.connect(node); node.connect(mute).connect(a.destination);
        node.onaudioprocess = e => this.frame(e.inputBuffer.getChannelData(0));
        st.getAudioTracks().forEach(tr => { tr.onended = () => this.stop(); });
        this.node = node; this.src = src; this.ready = true; return true;
      } catch (e) { this.starting = null; return false; }
    })();
    // Don't let a game wait forever if Chrome is still asking for microphone permission.
    return Promise.race([this.starting, wait(4000).then(() => false)]);
  },
  frame(d) {
    let s = 0; for (const x of d) s += x * x;
    const rms = Math.sqrt(s / d.length), ms = d.length / this.rate * 1000;
    this.level = rms;
    const thr = Math.max(0.02, this.floor * 3), loud = rms > thr, chunk = new Float32Array(d), j = this.job;
    if (!j || !j.cap) {
      if (!loud) this.floor = this.floor * 0.97 + rms * 0.03; // learn the room's background noise
      this.pre.push(chunk); if (this.pre.length > Math.ceil(400 / ms)) this.pre.shift();
    }
    if (!j) return;
    // Ignore our own voices and sounds, and the clatter of her hitting keys.
    const blocked = appTalking() || Date.now() - lastInput < 400;
    if (!j.cap) {
      if (Date.now() > j.deadline) return this.finish(null);
      if (blocked) { j.on = 0; return; }
      j.on = loud ? j.on + 1 : 0;
      if (j.on >= 3) { j.cap = this.pre.slice(); j.voiced = j.on * ms; j.quiet = 0; j.len = j.cap.length * ms; }
    } else {
      j.cap.push(chunk); j.len += ms;
      if (loud) { j.voiced += ms; j.quiet = 0; } else j.quiet += ms;
      if (j.quiet >= j.silence || j.len >= j.maxLen) {
        if (j.voiced < 250) { j.cap = null; j.on = 0; return; } // just a bump, keep listening
        const trim = Math.max(0, Math.floor((j.quiet - 250) / ms));
        this.finish(j.cap.slice(0, j.cap.length - trim));
      }
    }
  },
  finish(chunks) { const j = this.job; this.job = null; if (j) { clearTimeout(j.timer); j.resolve(chunks && chunks.length ? toWav(chunks, this.rate) : null); } },
  // Resolves with a WAV of what she said, or null if she stayed quiet.
  listen({ wait: w = 6000, maxLen = 5000, silence = 800 } = {}) {
    this.cancel();
    if (!this.ready) return Promise.resolve(null);
    return new Promise(resolve => {
      const j = this.job = { resolve, deadline: Date.now() + w, maxLen, silence, on: 0, cap: null };
      // Safety net: give up even if the microphone stops sending sound (screen lock, phone call...).
      j.timer = setTimeout(() => { if (this.job === j) this.finish(j.cap); }, w + maxLen + 1500);
    });
  },
  cancel() { if (this.job) { const j = this.job; this.job = null; clearTimeout(j.timer); j.resolve(null); } },
  stop() {
    this.cancel();
    try { if (this.node) { this.node.onaudioprocess = null; this.node.disconnect(); } if (this.src) this.src.disconnect(); } catch (e) {}
    if (micStream) micStream.getTracks().forEach(tr => tr.stop());
    micStream = null; this.node = this.src = null; this.ready = false; this.starting = null; this.level = 0; this.pre = [];
    setAudioSession('playback');
  },
};
const micOK = async () => S.listen && await ear.start();
// Plays back what she said; keeps it as a keepsake if the grown-ups chose to.
async function keepHer(blob, word) {
  if (S.keepVoice) {
    const id = uid(); await blobSet(id, blob);
    S.herClips.push({ id, word, date: today() });
    while (S.herClips.length > 80) { const old = S.herClips.shift(); await blobDel(old.id); }
    await save();
    return blobURL(id);
  }
  return URL.createObjectURL(blob);
}

// ---------------- Pip, her friend ----------------
const PIP_SVG = `<svg viewBox="0 0 200 230" aria-hidden="true">
<ellipse class="pshadow" cx="100" cy="222" rx="58" ry="7" fill="rgba(0,0,0,.12)"/>
<g class="pbody">
 <ellipse cx="78" cy="208" rx="17" ry="9" fill="#ff922b"/><ellipse cx="122" cy="208" rx="17" ry="9" fill="#ff922b"/>
 <ellipse class="parm pl" cx="30" cy="128" rx="15" ry="32" fill="#fab005"/>
 <ellipse class="parm pr" cx="170" cy="128" rx="15" ry="32" fill="#fab005"/>
 <path d="M90 46 C84 22 98 12 103 26 C108 8 128 16 114 46 Z" fill="#fab005"/>
 <circle cx="100" cy="122" r="82" fill="#ffd43b"/>
 <ellipse cx="100" cy="152" rx="50" ry="42" fill="#fff3bf"/>
 <g class="popen"><circle cx="72" cy="104" r="19" fill="#fff"/><circle cx="128" cy="104" r="19" fill="#fff"/>
  <circle cx="74" cy="107" r="10" fill="#3b2a1a"/><circle cx="130" cy="107" r="10" fill="#3b2a1a"/>
  <circle cx="78" cy="102" r="3.5" fill="#fff"/><circle cx="134" cy="102" r="3.5" fill="#fff"/></g>
 <g class="pjoy" fill="none" stroke="#3b2a1a" stroke-width="6" stroke-linecap="round"><path d="M58 108 Q72 90 86 108"/><path d="M114 108 Q128 90 142 108"/></g>
 <g class="psleep" fill="none" stroke="#3b2a1a" stroke-width="5" stroke-linecap="round"><path d="M58 104 Q72 116 86 104"/><path d="M114 104 Q128 116 142 104"/></g>
 <circle cx="50" cy="136" r="12" fill="#ff8787" opacity=".55"/><circle cx="150" cy="136" r="12" fill="#ff8787" opacity=".55"/>
 <path class="psm" d="M86 140 Q100 156 114 140" fill="none" stroke="#c92a2a" stroke-width="6" stroke-linecap="round"/>
 <ellipse class="pmo" cx="100" cy="146" rx="14" ry="11" fill="#c92a2a"/>
</g></svg>`;
function pipEl(size = '') { const d = h('div', { class: 'pip ' + size }); d.innerHTML = PIP_SVG; return d; }
function pipMood(p, mood, ms) {
  p.classList.remove('happy', 'listening', 'dance', 'wave', 'sleep');
  if (mood) { void p.offsetWidth; p.classList.add(mood); }
  if (mood && ms) setTimeout(() => p.classList.remove(mood), ms);
}
// Pip's mouth moves whenever anything is speaking; the listening ring grows with her voice.
(function lipSync() {
  const talking = !!speaking();
  for (const p of document.querySelectorAll('.pip')) {
    p.classList.toggle('talking', talking && !p.classList.contains('sleep'));
    p.style.setProperty('--lvl', Math.min(1, ear.level * 10).toFixed(2));
  }
  requestAnimationFrame(lipSync);
})();
// After a picture appears, Pip listens for a moment and cheers if she says anything.
async function invite(pip, t, alive, w = 4000) {
  if (!(await micOK()) || !alive()) return false;
  pipMood(pip, 'listening');
  const heard = await ear.listen({ wait: w });
  if (!alive()) return false;
  pipMood(pip, null);
  if (!heard) return false;
  pipMood(pip, 'happy', 2400); sfx.tada(); confetti(40);
  await keepHer(heard, thingName(t));
  await tts(pick(['Yes!', 'Well done!', 'Good talking!', 'Wow!']));
  if (alive()) await sayThing(t);
  return true;
}

// ---------------- pictures & effects ----------------
async function resizeImage(file, max = 900) {
  const url = URL.createObjectURL(file), img = new Image();
  try { await new Promise((r, j) => { img.onload = r; img.onerror = j; img.src = url; }); }
  finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  const sc = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * sc); c.height = Math.round(img.naturalHeight * sc);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
}
async function pictureEl(w) {
  const u = await blobURL(w.photo);
  return u ? h('img', { class: 'pic', src: u, alt: w.en }) : h('div', { class: 'emoji-pic' }, w.emoji || '⭐');
}
async function faceEl() {
  const u = await blobURL(S.photo);
  return u ? h('img', { class: 'face', src: u, alt: '' }) : h('div', { class: 'face emoji-pic' }, '🧒🏾');
}
function sparkle(x, y) {
  x = x ?? rand(60, innerWidth - 60); y = y ?? rand(60, innerHeight - 60);
  const s = h('div', { class: 'sparkle', style: `left:${x - 28}px;top:${y - 28}px` }, pick(['✨', '⭐', '🌟', '💫', '💖']));
  document.body.append(s); setTimeout(() => s.remove(), 950);
}
function confetti(n = 60) {
  const box = h('div', { class: 'confetti' });
  for (let i = 0; i < n; i++) box.append(h('i', { style: `left:${Math.random() * 100}%;background:${pick(COLORS)};animation-delay:${Math.random() * 0.5}s;animation-duration:${rand(1.6, 3)}s` }));
  document.body.append(box); setTimeout(() => box.remove(), 3800);
}
// Soft clouds drifting across the back of a screen.
function sky() {
  return h('div', { class: 'sky' }, [0, 1, 2].map(i => h('span', { class: 'cloud', style: `top:${8 + i * 22}%;animation-duration:${38 + i * 14}s;animation-delay:-${i * 13}s;font-size:${70 + i * 30}px` }, '☁️')));
}
function bdayInfo() {
  if (!S.birthday) return null;
  const b = new Date(S.birthday + 'T00:00'); if (isNaN(b)) return null;
  const now = new Date(), t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const next = new Date(t.getFullYear(), b.getMonth(), b.getDate());
  if (next < t) next.setFullYear(next.getFullYear() + 1);
  const days = Math.round((next - t) / 864e5);
  return { days, age: next.getFullYear() - b.getFullYear(), isToday: days === 0 };
}

// ---------------- install on this device ----------------
// Android and desktop Chrome/Edge offer a real install prompt; iPhone/iPad need a few taps in Safari,
// so for those we show the steps. Nothing shows once the app is already installed.
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; refreshInstall(); });
window.addEventListener('appinstalled', () => { installEvt = null; refreshInstall(); });
const isInstalled = () => matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true;
function devicePlatform() {
  const ua = navigator.userAgent;
  // iPads (and Chrome on iPad) often pretend to be a Mac; a Mac has no touch screen, and Chrome/Firefox leave their own marks.
  const iPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints > 1 || 'ontouchend' in document));
  const browser = /CriOS/.test(ua) || window.__gCrWeb ? 'chrome' : /FxiOS/.test(ua) || window.__firefox__ ? 'firefox' : /EdgiOS/.test(ua) ? 'edge' : 'safari';
  if (iPad || /iPhone|iPod/.test(ua)) return { os: iPad ? 'ipad' : 'iphone', browser };
  if (/Android/.test(ua)) return { os: 'android' };
  if (/Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Chromium|Edg|Firefox/.test(ua)) return { os: 'mac-safari' };
  return { os: 'desktop' };
}
const canInstall = () => !isInstalled() && (!!installEvt || ['iphone', 'ipad', 'mac-safari', 'android'].includes(devicePlatform().os));
function refreshInstall() { document.querySelectorAll('[data-install]').forEach(x => x.classList.toggle('hidden', !canInstall())); }
const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
async function doInstall() {
  if (installEvt) {
    const e = installEvt; installEvt = null;
    try { e.prompt(); await e.userChoice; } catch (err) {}
    refreshInstall(); return;
  }
  showInstallHelp();
}
const SHARE_ICON = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" fill="none" stroke="#1c7ed6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 10H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-2" fill="none" stroke="#1c7ed6" stroke-width="2" stroke-linecap="round"/></svg>';
const ADD_ICON = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4" fill="none" stroke="#212529" stroke-width="2"/><path d="M12 8v8M8 12h8" stroke="#212529" stroke-width="2" stroke-linecap="round"/></svg>';
function showInstallHelp() {
  const p = devicePlatform(), ic = html => { const s = h('span', { class: 'inst-ic' }); s.innerHTML = html; return s; };
  let title = 'Install Little World', steps;
  if (p.os === 'iphone' || p.os === 'ipad') {
    if (p.browser === 'safari') steps = [
      [ic(SHARE_ICON), `Tap the Share button ${p.os === 'ipad' ? 'at the top, next to the address bar' : 'at the bottom of the screen'}.`],
      [ic(ADD_ICON), 'Scroll down and tap "Add to Home Screen".'],
      ['✅', 'Tap "Add" in the top corner. Then open Little World from your home screen.']];
    else steps = [
      [ic(SHARE_ICON), p.browser === 'chrome' ? 'Tap the Share button at the top right, next to the address bar.' : 'Open the browser menu and tap Share.'],
      [ic(ADD_ICON), 'Scroll down and tap "Add to Home Screen". (Not there? Update the iPad/iPhone, or open this page in Safari and do it there.)'],
      ['✅', 'Tap "Add". Then open Little World from your home screen and set it up there (the installed app keeps its own photos and voices).']];
  } else if (p.os === 'android') steps = [
    ['⋮', 'Tap the menu (three dots) in the top corner of the browser.'],
    [ic(ADD_ICON), 'Tap "Install app" or "Add to Home screen".'],
    ['✅', 'Tap "Install". Then open Little World from your home screen.']];
  else if (p.os === 'mac-safari') steps = [
    ['🍎', 'In the menu bar at the top, click File.'],
    [ic(ADD_ICON), 'Click "Add to Dock", then "Add".'],
    ['✅', 'Open Little World from the Dock.']];
  else steps = [
    ['⬇️', 'Look for the install icon at the right of the address bar, or open the browser menu.'],
    [ic(ADD_ICON), 'Choose "Install Little World" (or "Apps → Install this site as an app").'],
    ['✅', 'Open Little World from your apps.']];
  const box = h('div', { class: 'inst-modal', role: 'dialog', 'aria-label': title },
    h('div', { class: 'inst-card' },
      h('h2', {}, '📲 ' + title),
      h('p', { class: 'inst-why' }, 'It opens full screen like a real app, works without internet, and is easy for little hands to find.'),
      h('ol', {}, steps.map(([icon, text]) => h('li', {}, typeof icon === 'string' ? h('span', { class: 'inst-ic' }, icon) : icon, h('span', {}, text)))),
      h('button', { class: 'inst-ok', onclick: () => box.remove() }, 'Got it')));
  for (const ev of ['pointerdown', 'click']) box.addEventListener(ev, e => { e.stopPropagation(); if (e.target === box && ev === 'click') box.remove(); });
  document.body.append(box);
}
// A small banner for grown-ups on the start screen; closing it hides it for two weeks.
function installBanner() {
  const last = +(store.get('lw-install-later') || 0);
  if (Date.now() - last < 14 * 864e5) return null;
  const stop = e => e.stopPropagation();
  const b = h('div', { class: 'inst-banner', 'data-install': '', onpointerdown: stop, onclick: stop },
    h('button', { class: 'inst-go', onclick: e => { e.stopPropagation(); doInstall(); } }, '📲 Install the app'),
    h('button', { class: 'inst-x', 'aria-label': 'Not now', onclick: e => { e.stopPropagation(); store.set('lw-install-later', String(Date.now())); b.remove(); } }, '✕'));
  if (!canInstall()) b.classList.add('hidden');
  return b;
}

// ---------------- screen manager ----------------
let screenGen = 0;
// Runs spoken steps one after another, stopping if the screen changes (so old speech can't talk over a new game).
async function chain(...steps) { const g = screenGen; for (const step of steps) { if (g !== screenGen) return; await step(); } }
function go(name, ...args) {
  if (cur && cur.cleanup) { try { cur.cleanup(); } catch (e) {} }
  screenGen++; stopSound(); ear.cancel();
  if (name === 'grown' || name === 'goodnight') ear.stop(); // free the microphone when nobody is playing
  const root = $('#app'); root.innerHTML = '';
  cur = SCREENS[name](...args) || {}; cur.name = name;
  if (!document.title.startsWith('LW-ERR')) document.title = 'Little World · ' + name;
  root.append(cur.el);
  $('#lock').classList.toggle('hidden', name === 'grown');
  if (!['grown', 'splash', 'goodnight'].includes(name) && !sessionStart) sessionStart = Date.now();
}
function homeBtn() { return h('button', { class: 'home-btn', 'aria-label': 'Home', onpointerdown: e => { e.stopPropagation(); go('home'); } }, '🏠'); }

document.addEventListener('keydown', e => {
  if (cur && cur.name === 'grown') return; // normal typing in the grown-up corner
  e.preventDefault(); lastInput = Date.now();
  if (e.repeat || !cur || !cur.onKey) return;
  ac();
  cur.onKey(e);
}, true);
document.addEventListener('pointerdown', () => { lastInput = Date.now(); }, true);
document.addEventListener('contextmenu', e => { if (!cur || cur.name !== 'grown') e.preventDefault(); });
document.addEventListener('gesturestart', e => e.preventDefault());

// Grown-up lock: hold for 3 seconds.
function buildLock() {
  const b = h('button', { id: 'lock', 'aria-label': 'Grown-up corner (hold 3 seconds)' }, h('span', { class: 'ring' }), '🔒');
  let t = null;
  const cancel = () => { clearTimeout(t); t = null; b.classList.remove('holding'); };
  b.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); b.classList.add('holding'); t = setTimeout(() => { cancel(); go('grown'); }, 3000); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => b.addEventListener(ev, cancel));
  document.body.append(b);
}

// Gentle wind-down after the play time set in the grown-up corner.
setInterval(() => {
  if (!S || !S.minutes || !sessionStart || !cur) return;
  if (['grown', 'goodnight', 'splash'].includes(cur.name)) return;
  if (Date.now() - sessionStart > S.minutes * 60000) go('goodnight');
}, 5000);

// ---------------- screens ----------------
SCREENS.splash = () => {
  const el = h('div', { class: 'screen splash' }, sky(), h('div', {}, '…'));
  (async () => {
    el.lastChild.remove();
    el.append(await faceEl(), h('h1', {}, `${S.name ? S.name + "'s" : 'Little'} World`), h('p', {}, 'Press any key or tap to play'), installBanner());
  })();
  let started = false;
  const start = async () => {
    if (started) return; started = true;
    ac(); if (S.listen) ear.start();
    try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen(); } catch (e) {}
    const bi = bdayInfo();
    go(bi && bi.isToday ? 'birthday' : 'home', true);
  };
  el.addEventListener('click', start);
  return { el, onKey: start };
};

SCREENS.home = (greet) => {
  const hasPhotos = photoThings().length > 0;
  let games = GAMES.filter(g => S.show.includes(g[0]) && (g[0] !== 'family' || hasPhotos));
  if (!games.length) games = GAMES.filter(g => g[0] !== 'family' || hasPhotos);
  const bi = bdayInfo();
  if (bi && bi.days <= 30) games.unshift(['birthday', '🎂', bi.isToday ? 'Birthday!' : 'Birthday']);
  const tiles = games.map(([id, ic, label], i) => h('button', { class: 'tile', style: `background:${COLORS[i % COLORS.length]};animation-delay:${i * 60}ms`, onclick: () => go(id) },
    ic === 'pip' ? pipEl('ontile') : h('span', { class: 'ic' }, ic), label));
  const header = h('header', {});
  const el = h('div', { class: 'screen home' }, sky(), header,
    bi && !bi.isToday && bi.days <= 30 ? h('div', { class: 'countdown' }, `🎂 ${bi.days} more ${bi.days === 1 ? 'sleep' : 'sleeps'} until ${herName()} turns ${bi.age}!`) : null,
    h('div', { class: 'tiles' + (tiles.length <= 8 ? ' few' : ''), style: `--cols:${tiles.length <= 4 ? 2 : tiles.length <= 6 ? 3 : 4}` }, tiles));
  (async () => { header.append(await faceEl(), h('h1', {}, `${S.name ? S.name + "'s" : 'Little'} World`)); })();
  if (greet) chain(() => tts('Hello'), sayName);
  let sel = -1, lastSay = 0;
  function key(e) {
    if ((e.key === 'Enter' || e.key === ' ') && sel >= 0) return go(games[sel][0]);
    sel = (sel + 1) % games.length;
    tiles.forEach((t, i) => t.classList.toggle('sel', i === sel));
    sfx.pop();
    if (Date.now() - lastSay > 900) { lastSay = Date.now(); tts(games[sel][2].replace(/[!?]/g, '')); }
  }
  return { el, onKey: key };
};

// Talk with Pip: Pip shows a picture, asks her to say it, listens, cheers and plays her own voice back.
SCREENS.talk = () => {
  const pip = pipEl('big'), card = h('div', { class: 'talk-card' }), label = h('div', { class: 'talk-word' });
  const note = h('div', { class: 'mic-note hidden' }, '🎤 Microphone is off, so Pip just talks');
  const el = h('div', { class: 'screen talk' }, sky(), homeBtn(), h('div', { class: 'talk-row' }, pip, h('div', { class: 'talk-right' }, card, label)), note,
    h('div', { class: 'hint' }, 'Say the word! Tap for a new picture'));
  const next = thingDeck();
  let alive = true, skip = false, lastSkip = 0;
  const go_on = () => alive && !skip;
  async function run() {
    await wait(300);
    const mic = await micOK();
    if (!alive) return;
    if (!mic) note.classList.remove('hidden');
    pipMood(pip, 'wave', 2000); await tts('Hello'); await sayName(); if (!alive) return; await tts("Let's talk!");
    while (alive) {
      skip = false; pipMood(pip, null);
      const t = next();
      card.innerHTML = ''; card.append(await thingPic(t)); card.classList.remove('pop'); void card.offsetWidth; card.classList.add('pop');
      label.textContent = thingName(t);
      if (t.self) { await tts("Look! It's"); if (go_on()) await sayName(); } else await sayWithSound('Look!', t);
      if (!go_on()) continue;
      await wait(300);
      if (t.self) await tts('Can you say your name?'); else await sayAround('Can you say', t, '?');
      if (!go_on()) continue;
      let heard = null;
      if (mic && await micOK()) { pipMood(pip, 'listening'); heard = await ear.listen({ wait: 6000 }); pipMood(pip, null); }
      else await wait(3000);
      if (!go_on()) continue;
      if (heard) {
        pipMood(pip, 'happy'); sfx.tada(); confetti(50);
        const clip = await keepHer(heard, thingName(t));
        await tts(pick(['Yay! You said it!', 'Well done!', 'Wow, clever!', 'Yes! Good talking!']));
        if (!go_on()) continue;
        pipMood(pip, 'dance'); await tts('Listen to you!'); await playURL(clip); await wait(300);
        if (!go_on()) continue;
        pipMood(pip, null); await sayThing(t);
      } else {
        await sayThing(t);
      }
      if (go_on()) await wait(1000);
    }
  }
  run();
  const skipNow = () => { if (Date.now() - lastSkip < 2500) return; lastSkip = Date.now(); skip = true; ear.cancel(); stopSound(); sfx.whoosh(); };
  el.addEventListener('pointerdown', e => { sparkle(e.clientX, e.clientY); skipNow(); });
  return { el, onKey: () => { sparkle(); skipNow(); }, cleanup() { alive = false; ear.cancel(); } };
};

// Copy me: Pip listens and repeats whatever she says in a squeaky voice.
SCREENS.copy = () => {
  const pip = pipEl('big'), msg = h('div', { class: 'copy-say' }, 'Say something!');
  const el = h('div', { class: 'screen copy' }, sky(), homeBtn(), pip, msg, h('div', { class: 'hint' }, 'Talk, sing or shout, and Pip copies you!'));
  let alive = true;
  async function run() {
    await wait(300);
    const mic = await micOK();
    if (!alive) return;
    if (!mic) { msg.textContent = '🎤 Microphone is off'; await tts('Tap me!'); return; }
    pipMood(pip, 'wave', 2000); await tts("Say something! I'll copy you!");
    while (alive) {
      pipMood(pip, 'listening'); msg.textContent = 'Say something! 👂';
      const heard = (await micOK()) ? await ear.listen({ wait: 20000, maxLen: 4000, silence: 700 }) : (await wait(4000), null);
      if (!alive) return;
      pipMood(pip, null);
      if (!heard) { await tts(pick(['Say something!', 'Hello? Talk to me!', 'Can you sing?'])); continue; }
      msg.textContent = '🦜 ✨';
      const url = URL.createObjectURL(heard);
      pipMood(pip, 'dance'); await playURL(url, 1.45); URL.revokeObjectURL(url);
      if (!alive) return;
      pipMood(pip, 'happy', 900); sfx.boing(); await wait(700);
    }
  }
  run();
  const tap = () => { pipMood(pip, 'happy', 700); sfx.boing(); };
  el.addEventListener('pointerdown', tap);
  return { el, onKey: tap, cleanup() { alive = false; ear.cancel(); } };
};

// Peekaboo: a picture hides under a blanket. Tap: "Peekaboo! There's Duck! Quack quack!" Tap again: it hides again.
SCREENS.peekaboo = (mode) => {
  const family = mode === 'family' && photoThings().length > 0;
  const picBox = h('div', { class: 'peek-pic' });
  const blanket = h('div', { class: 'blanket' }, h('span', {}, '🙈'));
  const label = h('div', { class: 'peek-label' });
  const pip = pipEl('side');
  const el = h('div', { class: 'screen peekaboo' + (family ? ' family' : '') }, sky(), homeBtn(), h('div', { class: 'peek-card' }, picBox, blanket), label, pip,
    h('div', { class: 'hint' }, 'Tap or press any key'));
  const next = family ? thingDeck(photoThings) : thingDeck();
  let thing = null, covered = true, busy = false, alive = true;
  const isAlive = () => alive;
  async function hide(first) {
    busy = true; covered = true; ear.cancel(); pipMood(pip, null);
    blanket.classList.remove('up'); label.textContent = '';
    if (!first) sfx.hide();
    await wait(first ? 0 : 450);
    if (first && family) { await tts('Family peekaboo'); if (!alive) return; }
    thing = next(); picBox.innerHTML = ''; picBox.append(await thingPic(thing));
    if (!alive) return;
    await wait(250); await sayAround("Where's", thing, '?');
    busy = false;
  }
  async function reveal() {
    busy = true; covered = false;
    blanket.classList.add('up'); sfx.peek(); confetti(30); pipMood(pip, 'happy', 1500);
    picBox.classList.remove('bounce'); void picBox.offsetWidth; picBox.classList.add('bounce');
    label.textContent = thingName(thing); label.classList.remove('pop'); void label.offsetWidth; label.classList.add('pop');
    await wait(450); if (!alive) return;
    await tts('Peekaboo!');
    if (thing.self) { await tts('There you are!'); await sayName(); } else await sayWithSound("There's", thing);
    busy = false;
    invite(pip, thing, isAlive, 3500);
  }
  const tap = () => { if (busy) return; covered ? reveal() : hide(); };
  el.addEventListener('pointerdown', e => { sparkle(e.clientX, e.clientY); tap(); });
  hide(true);
  return { el, onKey: () => { sparkle(); tap(); }, cleanup() { alive = false; } };
};

// Family peekaboo: the same game with only real photos. "Where's Mama?" ... "Peekaboo! There's Mama!"
SCREENS.family = () => SCREENS.peekaboo('family');

// Who's hiding? Three bushes; eyes peek out now and then. Tap one and someone pops up.
SCREENS.hiding = () => {
  const next = thingDeck();
  const spots = [0, 1, 2].map(i => {
    const peeker = h('div', { class: 'peeker' });
    const eyes = h('div', { class: 'bush-eyes' }, '👀');
    const bush = h('div', { class: 'bush', style: `--hue:${[110, 135, 95][i]}` }, eyes, h('span', {}, pick(['🌼', '🌸', '🌷'])));
    const spot = h('div', { class: 'spot' }, peeker, bush);
    return { spot, peeker, bush, eyes, busy: false };
  });
  const el = h('div', { class: 'screen hiding' }, homeBtn(), h('div', { class: 'spots' }, spots.map(s => s.spot)),
    h('div', { class: 'hint' }, 'Tap a bush'));
  let alive = true;
  async function open(s) {
    if (s.busy || !alive) return; s.busy = true;
    const t = next();
    s.peeker.innerHTML = ''; s.peeker.append(await thingPic(t), h('div', { class: 'peek-name' }, thingName(t)));
    s.bush.classList.remove('wiggle'); void s.bush.offsetWidth; s.bush.classList.add('wiggle');
    s.peeker.classList.add('out'); sfx.peek();
    await wait(350); if (!alive) return;
    if (t.self) { await tts('Peekaboo!'); await sayName(); } else await sayWithSound('Peekaboo!', t);
    await wait(1400); if (!alive) return;
    s.peeker.classList.remove('out'); sfx.hide();
    await wait(500); s.busy = false;
  }
  spots.forEach(s => s.spot.addEventListener('pointerdown', () => open(s)));
  // Every few seconds a pair of eyes peeks out of a bush, inviting her to tap it.
  const peekIv = setInterval(() => {
    const free = spots.filter(s => !s.busy); if (!free.length) return;
    const s = pick(free);
    s.eyes.classList.remove('peeking'); void s.eyes.offsetWidth; s.eyes.classList.add('peeking');
    s.bush.classList.remove('rustle'); void s.bush.offsetWidth; s.bush.classList.add('rustle');
  }, 2600);
  function key(e) {
    const free = spots.filter(s => !s.busy);
    if (!free.length) return;
    const want = spots[(e.key || 'a').toLowerCase().charCodeAt(0) % 3];
    open(free.includes(want) ? want : pick(free));
  }
  (async () => { await wait(300); if (alive) await tts("Who's hiding?"); })();
  return { el, onKey: key, cleanup() { alive = false; clearInterval(peekIv); } };
};

SCREENS.words = () => {
  const card = h('div', { class: 'wordcard' }), pip = pipEl('side');
  const el = h('div', { class: 'screen words' }, sky(), homeBtn(), card, pip, h('div', { class: 'hint' }, 'Press any key or tap'));
  let order = [], i = 0, busy = false, alive = true, lastNext = 0;
  async function next() {
    if (busy || !S.words.length || Date.now() - lastNext < 1500) return; // key-mashing can't skip faster than she can hear
    lastNext = Date.now(); busy = true; stopSound(); ear.cancel(); pipMood(pip, null);
    if (i >= order.length) { order = shuffle(S.words.map(w => w.id)); i = 0; }
    const w = S.words.find(x => x.id === order[i++]);
    if (w) {
      const pic = await pictureEl(w);
      card.innerHTML = ''; card.append(pic, h('div', { class: 'en' }, w.en));
      card.classList.remove('pop'); void card.offsetWidth; card.classList.add('pop');
      sfx.pop(); await wait(200);
      busy = false; // she can tap for the next picture at any time
      teach(w, ++lesson);
    } else busy = false;
  }
  // Teach it the way a teacher would: name it, say it again slowly, invite her, wait, then praise or say it once more.
  let lesson = 0;
  async function teach(w, me) {
    const still = () => alive && me === lesson;
    await sayWithSound('Look!', w); if (!still()) return;
    await wait(500); pipMood(pip, 'wave', 1200);
    await sayAround(pick(['Say it with me.', 'Can you say it?', 'Your turn!']), w, '!'); if (!still()) return;
    let heard = null;
    if (S.listen && ear.ready) { pipMood(pip, 'listening'); heard = await ear.listen({ wait: 4500 }); if (!still()) return; pipMood(pip, null); }
    else await wait(2500);
    if (!still()) return;
    if (heard) {
      pipMood(pip, 'happy', 2400); sfx.tada(); confetti(40); keepHer(heard, w.en);
      await tts(pick(['Yes!', 'Well done!', 'Good talking!'])); if (still()) await sayWord(w);
    } else {
      await sayWord(w); // say it once more, so she hears it again
    }
  }
  el.addEventListener('pointerdown', e => { sparkle(e.clientX, e.clientY); next(); });
  next();
  return { el, onKey: () => { sparkle(); next(); }, cleanup() { alive = false; } };
};

// ---------------- my body ----------------
// "Where's your nose?" A teddy shows each part while Pip asks her to find her own, then do the action.
const TEDDY_SVG = `<svg viewBox="0 0 300 420" aria-hidden="true">
 <g class="bp" data-part="ears"><circle cx="78" cy="62" r="38" fill="#b07040"/><circle cx="78" cy="62" r="20" fill="#f3d2a8"/>
  <circle cx="222" cy="62" r="38" fill="#b07040"/><circle cx="222" cy="62" r="20" fill="#f3d2a8"/></g>
 <ellipse cx="72" cy="262" rx="26" ry="44" fill="#b07040" transform="rotate(28 72 262)"/>
 <ellipse cx="228" cy="262" rx="26" ry="44" fill="#b07040" transform="rotate(-28 228 262)"/>
 <ellipse cx="150" cy="300" rx="86" ry="92" fill="#b07040"/>
 <g class="bp" data-part="hands"><ellipse cx="52" cy="292" rx="30" ry="30" fill="#9a5f35"/><ellipse cx="248" cy="292" rx="30" ry="30" fill="#9a5f35"/></g>
 <g class="bp" data-part="tummy"><ellipse cx="150" cy="306" rx="54" ry="58" fill="#f3d2a8"/></g>
 <g class="bp" data-part="toes"><ellipse cx="102" cy="384" rx="42" ry="28" fill="#9a5f35"/><ellipse cx="198" cy="384" rx="42" ry="28" fill="#9a5f35"/>
  <g fill="#f3d2a8"><circle cx="86" cy="376" r="7"/><circle cx="102" cy="370" r="7"/><circle cx="118" cy="376" r="7"/><ellipse cx="102" cy="392" rx="15" ry="10"/>
  <circle cx="182" cy="376" r="7"/><circle cx="198" cy="370" r="7"/><circle cx="214" cy="376" r="7"/><ellipse cx="198" cy="392" rx="15" ry="10"/></g></g>
 <circle cx="150" cy="130" r="96" fill="#b07040"/>
 <ellipse cx="150" cy="166" rx="44" ry="34" fill="#f3d2a8"/>
 <circle cx="96" cy="150" r="13" fill="#ff8787" opacity=".5"/><circle cx="204" cy="150" r="13" fill="#ff8787" opacity=".5"/>
 <g class="bp" data-part="eyes"><circle cx="112" cy="116" r="13" fill="#3b2a1a"/><circle cx="188" cy="116" r="13" fill="#3b2a1a"/>
  <circle cx="116" cy="111" r="4.5" fill="#fff"/><circle cx="192" cy="111" r="4.5" fill="#fff"/></g>
 <g class="bp" data-part="nose"><ellipse cx="150" cy="152" rx="17" ry="12" fill="#3b2a1a"/><ellipse cx="145" cy="148" rx="5" ry="3" fill="#fff" opacity=".6"/></g>
 <g class="bp" data-part="mouth"><path d="M130 176 Q150 196 170 176" fill="none" stroke="#3b2a1a" stroke-width="6" stroke-linecap="round"/></g>
</svg>`;
const BODY = [
  ['nose', "Where's your nose?", 'Touch your nose!'], ['eyes', 'Where are your eyes?', 'Touch your eyes!'],
  ['ears', 'Where are your ears?', 'Touch your ears!'], ['mouth', "Where's your mouth?", 'Touch your mouth!'],
  ['tummy', "Where's your tummy?", 'Pat your tummy!'], ['hands', 'Where are your hands?', 'Clap your hands!'],
  ['toes', 'Where are your toes?', 'Wiggle your toes!'],
];
SCREENS.body = () => {
  const teddy = h('div', { class: 'teddy' }); teddy.innerHTML = TEDDY_SVG;
  const finger = h('div', { class: 'finger hidden' }, '👆'), word = h('div', { class: 'body-word' }), pip = pipEl('side');
  const el = h('div', { class: 'screen body' }, sky(), homeBtn(), h('div', { class: 'body-row' }, teddy, word), finger, pip,
    h('div', { class: 'hint' }, 'Tap the teddy!'));
  const partEl = name => teddy.querySelector(`[data-part="${name}"]`);
  const cap = s => s[0].toUpperCase() + s.slice(1);
  let order = [], i = 0, lesson = 0, alive = true, lastNext = 0;
  function show(name) {
    teddy.querySelectorAll('.bp').forEach(p => p.classList.toggle('glow', p.dataset.part === name));
    // the finger points at the teddy's part
    const r = partEl(name).firstElementChild.getBoundingClientRect(); // one eye, one ear... not the gap between them
    finger.style.left = `${r.left + r.width / 2}px`; finger.style.top = `${r.top + r.height / 2}px`;
    finger.classList.remove('hidden', 'tap'); void finger.offsetWidth; finger.classList.add('tap');
    word.textContent = cap(name); word.classList.remove('pop'); void word.offsetWidth; word.classList.add('pop');
  }
  function boop(name) {
    const p = partEl(name); p.classList.remove('wig'); void p.getBoundingClientRect(); p.classList.add('wig');
    sfx.boing();
  }
  async function teach(part, me, short) {
    const [name, where, action] = part, still = () => alive && me === lesson;
    show(name); ear.cancel(); pipMood(pip, null);
    if (!short) {
      await wait(300); if (!still()) return;
      await tts(where); if (!still()) return;
      await wait(1600); if (!still()) return; // time to find her own
    }
    boop(name); await tts(`${cap(name)}!`); if (!still()) return;
    await wait(250); pipMood(pip, name === 'hands' || name === 'toes' ? 'dance' : 'wave', 2200);
    if (name === 'hands') [0, 450, 900].forEach(d => setTimeout(() => still() && sfx.pop(), 1100 + d)); // clap clap clap
    await tts(action); if (!still()) return;
    await wait(2200); if (!still()) return;
    pipMood(pip, 'happy', 1500); sfx.tada(); confetti(30);
    await tts(pick(['Yay!', 'Well done!', 'Wow!'])); if (!still() || short) return;
    await wait(300); await sayAround('Can you say', { en: name, rec: { en: [] } }, '?'); if (!still()) return;
    await invite(pip, { en: name, rec: { en: [] } }, still, 4000);
  }
  function next() {
    if (Date.now() - lastNext < 1500) return; // key-mashing can't skip faster than she can hear
    lastNext = Date.now(); stopSound();
    if (i >= order.length) { order = shuffle(BODY); i = 0; }
    teach(order[i++], ++lesson);
  }
  // Tapping the teddy names that part straight away.
  teddy.addEventListener('pointerdown', e => {
    const p = e.target.closest('.bp'); if (!p) return;
    e.stopPropagation(); sparkle(e.clientX, e.clientY);
    if (Date.now() - lastNext < 900) return;
    lastNext = Date.now(); stopSound();
    teach(BODY.find(b => b[0] === p.dataset.part), ++lesson, true);
  });
  el.addEventListener('pointerdown', e => { sparkle(e.clientX, e.clientY); next(); });
  setTimeout(() => alive && next(), 400);
  return { el, onKey: () => { sparkle(); next(); }, cleanup() { alive = false; } };
};

// ---------------- feed the animals ----------------
// An animal is hungry. Drag (or tap) a food to it: its favourite gets "Yum yum! Banana!", the others "No thank you!"
const FEED = [['🐵', 'monkey', '🍌', 'banana'], ['🐰', 'bunny', '🥕', 'carrot'], ['🐶', 'dog', '🦴', 'bone'], ['🐱', 'cat', '🐟', 'fish'],
  ['🐭', 'mouse', '🧀', 'cheese'], ['🐻', 'bear', '🍯', 'honey'], ['🐮', 'cow', '🌾', 'grass']];
SCREENS.feed = () => {
  const animal = h('div', { class: 'animal' }), tray = h('div', { class: 'foods' }), word = h('div', { class: 'feed-word' }), pip = pipEl('side');
  const el = h('div', { class: 'screen feed' }, sky(), homeBtn(), animal, word, tray, pip, h('div', { class: 'hint' }, 'Drag the food to the animal, or tap it'));
  const cap = s => s[0].toUpperCase() + s.slice(1);
  const thing = en => ({ en, rec: { en: [] } });
  let order = [], i = 0, want = null, busy = true, alive = true, drag = null;
  const still = () => alive;
  function centre(x) { const r = x.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }
  async function nextAnimal() {
    busy = true;
    if (i >= order.length) { order = shuffle(FEED); i = 0; }
    want = order[i++];
    animal.textContent = want[0]; animal.className = 'animal'; void animal.offsetWidth; animal.classList.add('enter');
    word.textContent = ''; tray.innerHTML = '';
    sfx.peek(); await wait(500); if (!alive) return;
    await sayWithSound('Look!', thing(cap(want[1]))); if (!alive) return;
    await tts(`${want[1]} is hungry!`); if (!alive) return;
    // its favourite food and two others, in a random order
    const foods = shuffle([want, ...shuffle(FEED.filter(f => f !== want)).slice(0, 2)]);
    foods.forEach((f, k) => tray.append(foodEl(f, k)));
    await wait(300); if (!alive) return;
    busy = false;
    await tts(`Feed the ${want[1]}!`);
  }
  function foodEl(f, k) {
    const b = h('div', { class: 'food', style: `animation-delay:${k * 120}ms` }, f[2]);
    b.dataset.food = f[3];
    b.addEventListener('pointerdown', e => {
      e.stopPropagation(); if (busy) return;
      drag = { b, x0: e.clientX, y0: e.clientY, moved: false, id: e.pointerId };
      try { b.setPointerCapture(e.pointerId); } catch (err) {}
      b.classList.add('drag'); sfx.pop();
    });
    b.addEventListener('pointermove', e => {
      if (!drag || drag.b !== b) return;
      const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
      if (Math.hypot(dx, dy) > 12) drag.moved = true;
      b.style.transform = `translate(${dx}px,${dy}px) scale(1.25)`;
    });
    const up = e => {
      if (!drag || drag.b !== b) return;
      const d = drag; drag = null; b.classList.remove('drag');
      const [ax, ay] = centre(animal), near = Math.hypot(e.clientX - ax, e.clientY - ay) < animal.offsetWidth * 0.75;
      if (!d.moved || near) give(b); // a tap sends it flying to the animal
      else { b.style.transform = ''; sfx.soft(); }
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', () => { if (drag && drag.b === b) { drag = null; b.classList.remove('drag'); b.style.transform = ''; } });
    return b;
  }
  async function give(b) {
    if (busy) return; busy = true; stopSound(); ear.cancel();
    const food = b.dataset.food, [ax, ay] = centre(animal), [bx, by] = centre(b);
    const base = b.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/), ox = base ? +base[1] : 0, oy = base ? +base[2] : 0;
    b.classList.add('fly'); b.style.transform = `translate(${ox + ax - bx}px,${oy + ay - by + animal.offsetHeight * 0.15}px) scale(.5)`;
    await wait(420); if (!alive) return;
    word.textContent = cap(food); word.classList.remove('pop'); void word.offsetWidth; word.classList.add('pop');
    if (food === want[3]) {
      b.classList.add('eaten'); animal.classList.remove('enter', 'shake'); void animal.offsetWidth; animal.classList.add('munch');
      [0, 220, 440].forEach(d => setTimeout(() => alive && tone(rand(180, 240), 0.08, 'square', 0.08), d)); // nom nom nom
      pipMood(pip, 'happy', 2500); confetti(50); setTimeout(() => alive && sfx.tada(), 600);
      await tts(`Yum yum! ${cap(food)}!`); if (!alive) return;
      await wait(300); await sayAround('Can you say', thing(food), '?'); if (!alive) return;
      await invite(pip, thing(food), still, 3500); if (!alive) return;
      await tts('All full!'); if (!alive) return;
      animal.classList.add('leave'); sfx.whoosh(); await wait(700); if (!alive) return;
      nextAnimal();
    } else {
      animal.classList.remove('enter', 'munch'); void animal.offsetWidth; animal.classList.add('shake');
      b.classList.remove('fly'); b.style.transform = ''; sfx.boing();
      await tts(`${cap(food)}? No thank you!`); if (!alive) return;
      busy = false;
    }
  }
  function key() {
    if (busy) return;
    const fs = [...tray.querySelectorAll('.food:not(.eaten)')]; if (fs.length) give(pick(fs));
  }
  setTimeout(() => alive && nextAnimal(), 300);
  return { el, onKey: () => { sparkle(); key(); }, cleanup() { alive = false; } };
};

// Counting: each tap adds one more thing; Pip counts them all, lighting each one up, like a teacher pointing.
const COUNT_THEMES = [['🦆', 'duck', 'ducks'], ['⚽', 'ball', 'balls'], ['⭐', 'star', 'stars'], ['🍎', 'apple', 'apples'],
  ['🚗', 'car', 'cars'], ['🐟', 'fish', 'fish'], ['🎈', 'balloon', 'balloons'], ['🐶', 'dog', 'dogs'], ['🍌', 'banana', 'bananas']];
const NUM_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
SCREENS.numbers = () => {
  const big = h('div', { class: 'big-num' }), row = h('div', { class: 'count-row' }), caption = h('div', { class: 'count-cap' });
  const pip = pipEl('side');
  const el = h('div', { class: 'screen numbers' }, sky(), homeBtn(), big, row, caption, pip, h('div', { class: 'hint' }, 'Tap or press a key to add one more'));
  const max = S.countTo || 5;
  let theme = pick(COUNT_THEMES), items = [], busy = false, alive = true;
  const still = () => alive;
  function fresh() {
    theme = pick(COUNT_THEMES.filter(t => t !== theme)); items = [];
    row.innerHTML = ''; big.textContent = ''; caption.textContent = '';
    row.classList.toggle('two-rows', max > 5);
  }
  async function add() {
    if (busy || !alive) return; busy = true; ear.cancel(); pipMood(pip, null);
    const n = items.length + 1;
    const it = h('div', { class: 'count-item' }, theme[0]);
    items.push(it); row.append(it); sfx.pop();
    // Count them all from one, lighting each as it's said.
    for (let i = 0; i < n; i++) {
      if (!alive) return;
      items[i].classList.remove('lit'); void items[i].offsetWidth; items[i].classList.add('lit');
      big.textContent = String(i + 1); big.classList.remove('pop'); void big.offsetWidth; big.classList.add('pop');
      tone(NOTES[Math.min(i, 7)], 0.18, 'triangle', 0.15);
      await tts(i + 1 === n ? `${NUM_WORDS[i + 1]}!` : NUM_WORDS[i + 1]);
    }
    if (!alive) return;
    caption.textContent = `${n} ${n === 1 ? theme[1] : theme[2]}`;
    await tts(`${NUM_WORDS[n]} ${n === 1 ? theme[1] : theme[2]}!`);
    if (n >= max) {
      pipMood(pip, 'happy', 2500); sfx.tada(); confetti(80);
      await tts(pick(['Well done! You counted them all!', 'Yay! Clever counting!', `Wow! ${NUM_WORDS[n]}!`]));
      if (alive && S.listen && ear.ready) {
        await tts(`Can you say ${NUM_WORDS[n]}?`);
        const t = { en: NUM_WORDS[n], rec: { en: [] } };
        await invite(pip, t, still, 4000);
      }
      if (!alive) return;
      await wait(600); row.classList.add('bye'); sfx.whoosh(); await wait(600); row.classList.remove('bye');
      fresh();
      await tts(`Let's count ${theme[2]}!`);
    }
    busy = false;
  }
  fresh();
  (async () => { await wait(300); if (alive) await tts(`Let's count ${theme[2]}! Tap!`); })();
  el.addEventListener('pointerdown', e => { sparkle(e.clientX, e.clientY); add(); });
  return { el, onKey: () => { sparkle(); add(); }, cleanup() { alive = false; } };
};

// ---------------- colours ----------------
// Taught like a teacher: show it, name it, name it with a thing, invite her, wait, praise or say it again.
const COLOURS = [
  ['red', '#fa5252', [['🍎', 'apple'], ['🚗', 'car']]], ['yellow', '#fcc419', [['🍌', 'banana'], ['☀️', 'sun']]],
  ['blue', '#339af0', [['🐟', 'fish'], ['💧', 'water']]], ['green', '#40c057', [['🐸', 'frog'], ['🌳', 'tree']]],
  ['orange', '#fd7e14', [['🥕', 'carrot']]], ['purple', '#845ef7', [['🍇', 'grapes']]], ['pink', '#f783ac', [['🐷', 'pig']]],
];
SCREENS.colours = () => {
  const splash = h('div', { class: 'colour-splash' }), word = h('div', { class: 'colour-word' }), things = h('div', { class: 'colour-things' });
  const pip = pipEl('side');
  const el = h('div', { class: 'screen colours' }, splash, homeBtn(), things, word, pip, h('div', { class: 'hint' }, 'Tap for a new colour'));
  let order = [], i = 0, lesson = 0, alive = true, lastNext = 0;
  const cap = s => s[0].toUpperCase() + s.slice(1);
  function next() {
    if (Date.now() - lastNext < 1500) return; // key-mashing can't skip faster than she can hear
    lastNext = Date.now(); stopSound(); ear.cancel(); pipMood(pip, null);
    if (i >= order.length) { order = shuffle(COLOURS); i = 0; }
    const [name, hex, objs] = order[i++];
    // the new colour washes over the screen from the middle
    el.style.background = splash.style.background || '#fff';
    splash.style.background = hex; splash.classList.remove('go'); void splash.offsetWidth; splash.classList.add('go');
    word.textContent = cap(name); word.style.color = hex; word.classList.remove('pop'); void word.offsetWidth; word.classList.add('pop');
    const [emoji, thing] = pick(objs);
    things.innerHTML = ''; things.append(h('span', {}, emoji)); things.classList.remove('pop'); void things.offsetWidth; things.classList.add('pop');
    sfx.whoosh();
    teach(name, thing, ++lesson);
  }
  async function teach(name, thing, me) {
    const still = () => alive && me === lesson;
    await wait(350); if (!still()) return;
    await tts(`Look! ${cap(name)}!`); if (!still()) return;
    await wait(250); await tts(`${cap(name)} ${thing}!`); if (!still()) return;
    await wait(400); pipMood(pip, 'wave', 1200);
    await tts(`${pick(['Say it with me.', 'Your turn!', 'Can you say'])} ${name}!`); if (!still()) return;
    let heard = null;
    if (await micOK()) { if (!still()) return; pipMood(pip, 'listening'); heard = await ear.listen({ wait: 4500 }); if (!still()) return; pipMood(pip, null); }
    else await wait(2500);
    if (!still()) return;
    if (heard) { pipMood(pip, 'happy', 2400); sfx.tada(); confetti(50); keepHer(heard, name); await tts(`Yes! ${cap(name)}!`); }
    else await tts(`${cap(name)}!`);
  }
  el.addEventListener('pointerdown', e => { sparkle(e.clientX, e.clientY); next(); });
  next();
  return { el, onKey: () => { sparkle(); next(); }, cleanup() { alive = false; } };
};

// ---------------- songs ----------------
// Traditional nursery songs (public domain), written in exact bars so they keep a steady beat.
// Each line: words | notes (name:beats, R = rest) | picture | chords (name:beats) | optional sound Pip says.
// "word-" joins to the next syllable; "{name}" is her name; "~" holds the previous word over another note.
// The notes and the chords of every line add up to the same number of beats.
const NOTE_I = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const noteMidi = n => { const m = /^([A-G])([#b]?)(\d)$/.exec(n); return 12 * (+m[3] + 1) + NOTE_I[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0); };
const midiHz = m => 440 * 2 ** ((m - 69) / 12);
const noteHz = n => midiHz(noteMidi(n));
const CHORDS = { C: ['C', 0], F: ['F', 0], G: ['G', 0], D: ['D', 0], Am: ['A', 1] }; // root, minor?
const beatsOf = b => (b ? (b.includes('/') ? b.split('/')[0] / b.split('/')[1] : +b) : 1);
const MAC_ANIMALS = [['cow', 'moo', '🐄'], ['duck', 'quack', '🦆'], ['dog', 'woof', '🐶']];
const MAC_FARM = 'Old Mac- Don- ald had a farm,|G4 G4 G4 D4 E4 E4 D4:2|👨‍🌾|G:2 G:2 C:2 G:2';
const MAC_EIEIO = pic => `E- I- E- I- O!|B4 B4 A4 A4 G4:4|${pic}|G:2 D:2 G:4`;
const SONGS = [
  { id: 'twinkle', title: 'Twinkle Twinkle', say: 'Twinkle Twinkle', icon: '⭐', bpm: 104, meter: 4, lines: [
    'Twin- kle twin- kle lit- tle star,|C4 C4 G4 G4 A4 A4 G4:2|⭐|C:2 C:2 F:2 C:2',
    'How I won- der what you are!|F4 F4 E4 E4 D4 D4 C4:2|✨|F:2 C:2 G:2 C:2',
    'Up a- bove the world so high,|G4 G4 F4 F4 E4 E4 D4:2|🌙|C:2 F:2 C:2 G:2',
    'Like a dia- mond in the sky!|G4 G4 F4 F4 E4 E4 D4:2|💎|C:2 F:2 C:2 G:2',
    'Twin- kle twin- kle lit- tle star,|C4 C4 G4 G4 A4 A4 G4:2|⭐|C:2 C:2 F:2 C:2',
    'How I won- der what you are!|F4 F4 E4 E4 D4 D4 C4:2|✨|F:2 C:2 G:2 C:2'] },
  { id: 'mac', title: 'Old MacDonald', say: 'Old MacDonald', icon: '🐄', bpm: 126, meter: 4, lines: MAC_ANIMALS.flatMap(([a, s, pic]) => {
    const S2 = s[0].toUpperCase() + s.slice(1);
    return [MAC_FARM, MAC_EIEIO('👨‍🌾'),
      `And on his farm he had a ${a},|D4:0.5 G4:0.5 G4 G4 D4 E4 E4 D4:2|${pic}|G:2 G:2 C:2 G:2`,
      MAC_EIEIO(pic),
      `${S2} ${s}!|R:2 R:2|${pic}|G:2 D:2|${s} ${s}`,
      `With a ${s} ${s} here, and a ${s} ${s} there,|D4:0.5 D4:0.5 G4 G4 G4 D4:0.5 D4:0.5 G4 G4 G4|${pic}|G:4 G:4`,
      `Here a ${s}, there a ${s}, ev- ery- where a ${s} ${s}!|G4:0.5 G4:0.5 G4 G4:0.5 G4:0.5 G4 G4:0.5 G4:0.5 G4:0.5 G4:0.5 G4 G4|${pic}|G:4 D:2 G:2`,
      MAC_FARM, MAC_EIEIO(pic)];
  }) },
  { id: 'spider', title: 'Itsy Bitsy Spider', say: 'Itsy Bitsy Spider', icon: '🕷️', bpm: 100, meter: 4, lines: [
    'The it- sy bit- sy spi- der climbed up the wa- ter spout.|G4:0.5 C5:0.5 C5:0.5 C5:0.5 D5:0.5 E5 E5:0.5 E5:0.5 D5:0.5 C5:0.5 D5:0.5 E5:0.5 C5:1.5|🕷️⬆️|C:4 G:2 C:2',
    'Down came the rain and washed the spi- der out!|E5 E5:0.5 F5:0.5 G5:2 G5:0.5 F5:0.5 E5:0.5 F5:0.5 G5:0.5 E5:1.5|🌧️|C:2 F:2 G:2 C:2',
    'Out came the sun and dried up all the rain,|C5 C5:0.5 D5:0.5 E5:2 E5:0.5 D5:0.5 C5:0.5 D5:0.5 E5:0.5 C5:1.5|☀️|C:4 G:2 C:2',
    'And the it- sy bit- sy spi- der climbed up the spout a- gain!|G4:0.5 G4:0.5 C5:0.5 C5:0.5 C5:0.5 D5:0.5 E5:0.5 E5:0.5 E5:0.5 D5:0.5 C5:0.5 D5 E5:0.5 C5|🕷️⬆️|C:4 G:2 C:2'] },
  { id: 'boat', title: 'Row Your Boat', say: 'Row Your Boat', icon: '🚣', bpm: 96, meter: 4, lines: [0, 1].flatMap(() => [
    'Row, row, row your boat,|C4 C4 C4:0.75 D4:0.25 E4|🚣|C:4',
    'Gent- ly down the stream.|E4:0.75 D4:0.25 E4:0.75 F4:0.25 G4:2|🌊|C:4',
    'Mer- ri- ly mer- ri- ly mer- ri- ly mer- ri- ly,|C5:1/3 C5:1/3 C5:1/3 G4:1/3 G4:1/3 G4:1/3 E4:1/3 E4:1/3 E4:1/3 C4:1/3 C4:1/3 C4:1/3|😄|C:2 G:2',
    'Life is but a dream!|G4:0.75 F4:0.25 E4:0.75 D4:0.25 C4:2|💤|G:2 C:2']) },
  { id: 'where', title: 'Where is {name}?', say: '', icon: '🙈', bpm: 100, meter: 4, name: true, lines: [
    'Where is {name}? ~ Where is {name}? ~|C4 D4 E4 C4 C4 D4 E4 C4|🙈|C:4 C:4',
    'Here you are! Here you are!|E4 F4 G4:2 E4 F4 G4:2|FACE|C:4 C:4',
    'How are you to- day, {name}?|G4:0.5 A4:0.5 G4:0.5 F4:0.5 E4 C4|FACE|C:4',
    'Ve- ry well, I thank you!|G4:0.5 A4:0.5 G4:0.5 F4:0.5 E4 C4|😊|C:4',
    'Peek- a- boo! Peek- a- boo!|C4 G3 C4:2 C4 G3 C4:2|🙈FACE|C:2 G:2 C:4'] },
  { id: 'bday', title: 'Happy Birthday', say: 'Happy birthday', icon: '🎂', bpm: 108, meter: 3, name: true, lines: [
    'Hap- py birth- day to you,|G4:0.75 G4:0.25 A4 G4 C5 B4:2|🎂|C:1 C:3 G:2',
    'Hap- py birth- day to you,|G4:0.75 G4:0.25 A4 G4 D5 C5:2|🎈|G:1 G:3 C:2',
    'Hap- py birth- day dear {name} ~|G4:0.75 G4:0.25 G5 E5 C5 B4 A4|FACE|C:1 C:3 F:2',
    'Hap- py birth- day to you!|F5:0.75 F5:0.25 E5 C5 D5 C5:2|🎉|F:1 C:2 G:1 C:2'] },
];
function parseLine(str) {
  const [words, notes, pic, chords, sound] = str.split('|');
  const toks = words.split(' '), ns = notes.split(' ');
  return {
    pic, sound,
    notes: ns.map((n, i) => { const [nm, b] = n.split(':'); return { hz: nm === 'R' ? 0 : noteHz(nm), beats: beatsOf(b), tok: toks[i] || '~' }; }),
    chords: (chords || '').split(' ').filter(Boolean).map(c => { const [nm, b] = c.split(':'); return { nm, beats: beatsOf(b) }; }),
  };
}
// A soft music-box melody, a bass note and chords on the beat, and a shaker: a little band.
function bell(t, hz, dur, vol = 0.2) {
  const a = ac(), g = a.createGain(), o1 = a.createOscillator(), o2 = a.createOscillator(), g2 = a.createGain();
  o1.type = 'triangle'; o1.frequency.value = hz; o2.type = 'sine'; o2.frequency.value = hz * 2; g2.gain.value = 0.25;
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.001, t + Math.max(0.25, dur * 0.95));
  o1.connect(g); o2.connect(g2).connect(g); g.connect(a.destination);
  o1.start(t); o2.start(t); o1.stop(t + dur + 0.1); o2.stop(t + dur + 0.1);
  return [o1, o2];
}
function pluck(t, hz, dur, vol, type = 'sine') {
  const a = ac(), o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.value = hz;
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.05);
  return [o];
}
function thump(t, vol = 0.35) { // a soft kick drum on the strong beats
  const a = ac(), o = a.createOscillator(), g = a.createGain();
  o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(50, t + 0.15);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + 0.25);
  return [o];
}
let noiseBuf = null;
function shaker(t, vol = 0.04) {
  const a = ac();
  if (!noiseBuf) { noiseBuf = a.createBuffer(1, Math.floor(a.sampleRate * 0.08), a.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length); }
  const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  s.buffer = noiseBuf; f.type = 'highpass'; f.frequency.value = 5000; g.gain.value = vol;
  s.connect(f).connect(g).connect(a.destination); s.start(t);
  return [s];
}
// Plays one chord for `beats` beats: bass + kick on the first beat of each bar, soft chord on the others.
function backing(t, chord, beats, beat, meter, barPos) {
  const [root, minor] = CHORDS[chord] || CHORDS.C, r = noteMidi(root + '3'), out = [];
  const triad = [r + 12, r + 12 + (minor ? 3 : 4), r + 12 + 7];
  for (let k = 0; k < Math.round(beats); k++) {
    const at = t + k * beat, strong = (barPos + k) % meter === 0;
    if (k === 0 || strong) { out.push(...pluck(at, midiHz(r - 12), beat * 0.9, 0.22, 'triangle')); }
    if (strong) out.push(...thump(at));
    else triad.forEach(m => out.push(...pluck(at, midiHz(m), beat * 0.45, 0.045, 'triangle')));
  }
  return out;
}
const PENTA = ['C5', 'D5', 'E5', 'G5', 'A5', 'C6'].map(noteHz);
// Schedules a whole song from audio time t0: a bar of count-in, the band, the tune, and the family's recorded singing if given.
// Returns the sound nodes (to stop it early), cues (when each line starts and each note plays, for the words on screen) and the end time.
function scheduleSong(song, t0, { melody = 0.2, voice = null } = {}) {
  const a = ac(), beat = 60 / song.bpm, nodes = [], cues = [];
  let t = t0, barPos = 0;
  for (let k = 0; k < song.meter; k++) { nodes.push(...shaker(t, k === 0 ? 0.09 : 0.06), ...pluck(t, k === 0 ? 1568 : 1175, 0.08, 0.06)); t += beat; }
  song.lines.map(parseLine).forEach((line, li) => {
    const lineStart = t;
    cues.push({ at: lineStart, line, li });
    let ct = lineStart, cb = barPos;
    for (const c of line.chords) { nodes.push(...backing(ct, c.nm, c.beats, beat, song.meter, cb)); ct += c.beats * beat; cb = (cb + c.beats) % song.meter; }
    line.notes.forEach(n => {
      const dur = n.beats * beat;
      if (n.hz && melody) nodes.push(...bell(t, n.hz, dur, melody));
      cues.push({ at: t, line, note: n, dur });
      t += dur;
    });
    for (let b = lineStart; b < t - 0.01; b += beat / 2) nodes.push(...shaker(b, Math.abs(((b - lineStart) / beat) % 1) < 0.01 ? 0.045 : 0.025));
    barPos = (barPos + Math.round((t - lineStart) / beat)) % song.meter;
  });
  if (voice) {
    // voice.offset is where the count-in starts inside the recording
    const src = a.createBufferSource(), g = a.createGain(), start = t0 - voice.offset, when = Math.max(a.currentTime, start);
    src.buffer = voice.buf; g.gain.value = 1.5; src.connect(g).connect(a.destination);
    src.start(when, when - start); nodes.push(src);
  }
  return { nodes, cues, end: t };
}
// Shows a line of words; each "~" note holds the word before it.
function showLyric(box, line) {
  box.innerHTML = ''; let last = null;
  line.notes.forEach(n => {
    if (n.tok === '~') { n.span = last; return; }
    n.span = last = h('span', { class: 'syl' + (n.tok.endsWith('-') ? ' join' : '') }, n.tok.replace('{name}', herName()).replace(/-$/, ''));
    box.append(n.span);
  });
}
function lightLyric(box, n) { box.querySelectorAll('.syl.on').forEach(x => x.classList.remove('on')); if (n.span) n.span.classList.add('on'); }
async function songVoice(id) {
  const r = S.songRec[id]; if (!r) return null;
  try { const b = await blobGet(r.id); return b ? { buf: await decodeAudio(await b.arrayBuffer()), offset: r.offset } : null; } catch (e) { return null; }
}

SCREENS.songs = () => {
  const pip = pipEl('side'), stage = h('div', { class: 'song-stage' });
  const el = h('div', { class: 'screen songs' }, sky(), homeBtn(), stage, pip);
  let alive = true, playing = false, nodes = [], timers = [], nextIdx = 0;
  const list = () => SONGS.filter(s => s.id !== 'bday' || (bdayInfo() && bdayInfo().days <= 30));
  const later = (fn, ms) => timers.push(setTimeout(() => alive && fn(), Math.max(0, ms)));
  function stopSong() { for (const n of nodes) { try { n.stop(); } catch (e) {} } nodes = []; timers.forEach(clearTimeout); timers = []; playing = false; voiceUntil = 0; }
  function picker() {
    stopSong(); pipMood(pip, null);
    const songs = list();
    stage.innerHTML = '';
    stage.append(h('div', { class: 'song-grid' }, songs.map((s, i) => h('button', {
      class: 'song-card', style: `background:${COLORS[(i + 2) % COLORS.length]}`,
      onclick: e => { e.stopPropagation(); play(s); },
    }, h('span', { class: 'ic' }, s.icon), s.title.replace('{name}', herName()), S.songRec[s.id] ? h('span', { class: 'sung' }, '🎤 Family') : null))));
  }
  async function play(song) {
    stopSong(); playing = true; nextIdx = list().indexOf(song) + 1;
    const scene = h('div', { class: 'song-scene' }), lyric = h('div', { class: 'lyric' });
    stage.innerHTML = ''; stage.append(scene, lyric);
    scene.textContent = song.icon;
    pipMood(pip, 'wave', 1500);
    const voiceP = songVoice(song.id);
    if (song.name) { await tts("Let's sing!"); if (!alive || !playing) return; await sayName(); }
    else await tts(`Let's sing! ${song.say}!`);
    const face = await faceEl(), voice = await voiceP;
    if (!alive || !playing) return;
    pipMood(pip, 'dance');
    const a = ac(), ms = at => (at - a.currentTime) * 1000;
    // with a family recording, the tune is just a soft guide under their voice
    const plan = scheduleSong(song, a.currentTime + 0.3, { melody: voice ? 0.05 : 0.2, voice });
    nodes = plan.nodes;
    for (const c of plan.cues) {
      if (!c.note) later(() => {
        showLyric(lyric, c.line);
        scene.innerHTML = '';
        for (const part of c.line.pic.split(/(FACE)/).filter(Boolean)) scene.append(part === 'FACE' ? face.cloneNode(true) : h('span', {}, part));
        scene.className = 'song-scene ' + song.id + ' l' + c.li;
        scene.classList.remove('pop'); void scene.offsetWidth; scene.classList.add('pop');
        if (c.line.sound) { pipMood(pip, 'happy', 1500); if (!voice) tts(c.line.sound + '!'); }
      }, ms(c.at) - 80);
      else later(() => {
        lightLyric(lyric, c.note);
        if (c.note.hz && !c.line.sound) voiceUntil = Date.now() + c.dur * 850; // Pip sings each note
        if (ear.level > 0.06 && Math.random() < 0.5) sparkle();
      }, ms(c.at));
    }
    later(async () => {
      playing = false; lyric.innerHTML = ''; pipMood(pip, 'happy', 2500); sfx.tada(); confetti(80);
      await tts(pick(['Lovely singing!', 'Yay!', 'Well done!']));
      setTimeout(() => alive && !playing && picker(), 1200);
    }, ms(plan.end) + 300);
  }
  function key() {
    if (playing) { nodes.push(...bell(ac().currentTime, pick(PENTA), 0.4, 0.12)); sparkle(); return; } // she plays along
    const songs = list(); play(songs[nextIdx % songs.length]);
  }
  picker();
  (async () => { await wait(300); if (alive && !playing) await tts("Let's sing!"); })();
  el.addEventListener('pointerdown', () => { if (playing) key(); });
  return { el, onKey: key, cleanup() { alive = false; stopSong(); } };
};

SCREENS.paint = () => {
  const c = h('canvas', {});
  const el = h('div', { class: 'screen paintwrap' }, c, homeBtn(), h('div', { class: 'paint-tools' }, h('button', { class: 'big-btn', onpointerdown: e => { e.stopPropagation(); sfx.whoosh(); size(); } }, '✨ New picture')));
  const ctx = c.getContext('2d');
  let hue = Math.random() * 360, last = null, down = false;
  function size() {
    const r = devicePixelRatio || 1; c.width = innerWidth * r; c.height = innerHeight * r;
    ctx.setTransform(r, 0, 0, r, 0, 0); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, innerWidth, innerHeight);
  }
  size();
  function line(x, y) {
    ctx.strokeStyle = `hsl(${hue},85%,58%)`; ctx.lineWidth = 30; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(last ? last.x : x, last ? last.y : y); ctx.lineTo(x, y); ctx.stroke();
    hue = (hue + 2) % 360; last = { x, y };
  }
  // A mouse or trackpad paints just by moving (a 2-year-old can't hold the click); touch paints while touching.
  c.addEventListener('pointerdown', e => { down = true; last = null; line(e.offsetX, e.offsetY); sfx.pop(); });
  c.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' || down) line(e.offsetX, e.offsetY); });
  c.addEventListener('pointerup', () => { down = false; last = null; });
  c.addEventListener('pointerleave', () => { last = null; });
  function stamp() {
    const x = rand(40, innerWidth - 40), y = rand(60, innerHeight - 60);
    ctx.font = '90px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(pick(['⭐', '❤️', '🌸', '🦋', '🌈', '🐞', '☀️', '🍓', '🐠', '🌼']), x, y);
    sfx.pop();
  }
  return { el, onKey: stamp };
};

// Bubbles: Pip says "Pop!" as they burst and dances when she talks.
SCREENS.bubbles = () => {
  const field = h('div', { class: 'field' }), pip = pipEl('buddy');
  const note = h('div', { class: 'mic-note' }, '🎤 Talk to Pip!');
  const el = h('div', { class: 'screen bubbles' }, field, pip, homeBtn());
  let alive = true, raf = 0, loud = 0, lastCheer = 0, lastPop = 0;
  const photoWords = S.words.filter(w => w.photo);
  async function spawn() {
    const size = rand(80, 160);
    const b = h('div', { class: 'bubble', style: `width:${size}px;height:${size}px;left:${rand(2, 88)}%;animation-duration:${rand(7, 12)}s` });
    if (photoWords.length && Math.random() < 0.3) {
      const w = pick(photoWords), u = await blobURL(w.photo);
      if (u) { b.style.backgroundImage = `url(${u})`; b.classList.add('photo'); b.dataset.word = w.id; }
    }
    b.addEventListener('pointerdown', e => { e.stopPropagation(); pop(b); });
    b.addEventListener('animationend', () => { if (!b.classList.contains('popped')) b.remove(); });
    if (alive) field.append(b);
  }
  function pop(b) {
    if (!b || b.classList.contains('popped')) return;
    b.classList.add('popped'); sfx.pop();
    const w = b.dataset.word && S.words.find(x => x.id === b.dataset.word);
    if (w) sayWord(w);
    else if (!speaking() && Date.now() - lastPop > 1200) {
      lastPop = Date.now(); pipMood(pip, 'happy', 600);
      tts(pick(['Pop!', 'Pop!', 'Pop pop!', 'Pop!', 'Wheee!']), 1.25);
    }
    setTimeout(() => b.remove(), 320);
  }
  const popAny = () => { const bs = [...field.querySelectorAll('.bubble:not(.popped)')]; bs.length ? pop(pick(bs)) : sfx.soft(); };
  const iv = setInterval(() => { if (field.children.length < 14) spawn(); }, 650);
  for (let i = 0; i < 4; i++) setTimeout(spawn, i * 200);
  function loop() {
    if (!alive) return;
    if (!appTalking() && ear.level > 0.05) {
      loud++; pip.classList.add('dance');
      if (loud % 8 === 0) popAny();
      if (loud > 25 && Date.now() - lastCheer > 7000) { lastCheer = Date.now(); tts(pick(['I hear you!', 'Yay! Talk to me!', 'What a big voice!'])); }
    } else { loud = Math.max(0, loud - 1); if (!loud) pip.classList.remove('dance'); }
    raf = requestAnimationFrame(loop);
  }
  micOK().then(ok => { if (ok && alive) { el.append(note); loop(); } });
  el.addEventListener('pointerdown', popAny);
  return { el, onKey: popAny, cleanup() { alive = false; clearInterval(iv); cancelAnimationFrame(raf); } };
};

SCREENS.piano = () => {
  const keys = ANIMALS.map((a, i) => h('div', { class: 'pkey', style: `--c:${COLORS[i]}`, onpointerdown: () => hit(i) },
    h('div', { class: 'pa' }, a[0]), h('div', { class: 'pn' }, a[1])));
  const el = h('div', { class: 'screen piano' }, homeBtn(), h('div', { class: 'pkeys' }, keys));
  let lastSay = 0, sound = false;
  function hit(i) {
    tone(NOTES[i], 0.5, 'triangle', 0.3);
    const k = keys[i]; k.classList.remove('hit'); void k.offsetWidth; k.classList.add('hit');
    if (Date.now() - lastSay > 1500) {
      lastSay = Date.now(); sound = !sound;
      const name = ANIMALS[i][1], w = S.words.find(x => x.en.toLowerCase() === name.toLowerCase());
      // Alternate the animal's name and its sound: "Cow" ... "Moo!"
      const g = screenGen;
      setTimeout(() => g === screenGen && (sound ? tts(SOUNDS[name.toLowerCase()], 1.15) : w ? sayWord(w) : tts(name)), 350);
    }
  }
  const row = 'asdfghjk';
  return { el, onKey: e => { const k = (e.key || 'a').toLowerCase(); hit(row.includes(k) ? row.indexOf(k) : k.charCodeAt(0) % 8); } };
};

SCREENS.birthday = () => {
  const bi = bdayInfo(), n = Math.max(1, Math.min(8, bi ? bi.age : 2));
  const flames = [], candles = h('div', { class: 'candles' });
  for (let i = 0; i < n; i++) { const f = h('div', { class: 'flame' }); flames.push(f); candles.append(h('div', { class: 'candle', onpointerdown: blowOne }, f)); }
  const top = h('div', {});
  const el = h('div', { class: 'screen birthday' }, homeBtn(), top, h('div', { class: 'bmsg' }, `Happy Birthday, ${herName()}!`),
    h('div', { class: 'cake' }, candles, h('div', { class: 'cake-body' }, h('div', { class: 'cake-num' }, String(n)))),
    h('div', { class: 'hint' }, 'Blow! 🌬️ Or tap the candles'));
  (async () => top.append(await faceEl()))();
  let alive = true, raf = 0, loud = 0, partying = false;
  function blowOne() {
    if (partying) return;
    const f = flames.find(f => !f.classList.contains('out')); if (!f) return;
    f.classList.add('out'); tone(200, 0.25, 'sine', 0.12);
    if (flames.every(f => f.classList.contains('out'))) party();
  }
  async function party() {
    partying = true; sfx.tada(); confetti(120); setTimeout(() => alive && confetti(120), 1000);
    await wait(700);
    if (S.bdayRec.length) { for (const id of S.bdayRec) { if (!alive) return; await playBlob(id); await wait(300); } }
    else await chain(() => tts('Happy birthday'), sayName, () => tts(`You are ${NUM_WORDS[n]}!`));
    await wait(1500);
    if (alive) { flames.forEach(f => f.classList.remove('out')); partying = false; }
  }
  function loop() {
    if (!alive) return;
    if (!appTalking() && ear.level > 0.12) { if (++loud > 8) { loud = 0; blowOne(); } } else loud = Math.max(0, loud - 1);
    raf = requestAnimationFrame(loop);
  }
  micOK().then(ok => ok && alive && loop());
  chain(() => tts('Happy birthday'), sayName, () => tts("Let's blow out the candles!"));
  return { el, onKey: blowOne, cleanup() { alive = false; cancelAnimationFrame(raf); } };
};

SCREENS.goodnight = () => {
  const pip = pipEl('big sleep');
  const el = h('div', { class: 'screen goodnight' }, h('div', { class: 'zz' }, 'z z z'), pip,
    h('h1', {}, 'All done for now!'), h('p', {}, 'Night night 🌙  Pip is sleeping'));
  chain(() => tts('All done for now'), sayName, () => tts('Night night!'));
  return { el, onKey: () => {} };
};

// ---------------- grown-up corner ----------------
function recButton(label, onBlob) {
  const b = h('button', { class: 'rec' }, '🎙 ' + label);
  let r = null;
  b.onclick = async () => {
    if (r) return r.stop();
    try { r = await recordClip(6000); }
    catch (e) { alert('The microphone is blocked. Click the camera/mic icon in the address bar and allow it, then try again.'); return; }
    b.classList.add('on'); b.textContent = '■ Stop';
    const blob = await r.done; r = null;
    b.classList.remove('on'); b.textContent = '🎙 ' + label;
    if (!blob.size) return;
    const id = uid(); await blobSet(id, blob); await onBlob(id); playBlob(id);
  };
  return b;
}
async function recordClip(maxMs = 6000) {
  const st = await getMic();
  const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
  const rec = new MediaRecorder(st, mime ? { mimeType: mime } : undefined), chunks = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise(r => { rec.onstop = () => r(new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' })); });
  rec.start();
  const t = setTimeout(() => rec.state !== 'inactive' && rec.stop(), maxMs);
  return { stop() { clearTimeout(t); if (rec.state !== 'inactive') rec.stop(); }, done };
}
function recChip(text, id, onDelete) {
  return h('span', { class: 'chip' }, text,
    h('button', { title: 'Play', onclick: () => playBlob(id) }, '▶'),
    h('button', { title: 'Delete', onclick: async () => { if (confirm('Delete this recording?')) { await blobDel(id); await onDelete(); } } }, '✕'));
}
function photoPicker(onBlob) {
  const inp = h('input', { type: 'file', accept: 'image/*', style: 'display:none' });
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    try { const blob = await resizeImage(f); const id = uid(); await blobSet(id, blob); await onBlob(id); }
    catch (e) { alert("That photo didn't open. If it came from an iPhone (HEIC), open it in Preview, choose File → Export, pick JPEG, then try again."); }
    inp.value = '';
  };
  return inp;
}
function allBlobIds() {
  const ids = [S.photo, ...S.nameRec, ...S.bdayRec, ...S.herClips.map(c => c.id), ...Object.values(S.songRec).map(r => r.id)];
  for (const w of S.words) { ids.push(w.photo); for (const r of w.rec.en) ids.push(r.id); }
  return ids.filter(Boolean);
}
const blobToDataURL = b => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
function download(blob, name) { const u = URL.createObjectURL(blob), a = h('a', { href: u, download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 60000); }

SCREENS.grown = () => {
  const el = h('div', { class: 'screen grown' });
  const rerender = async () => { const y = el.scrollTop; await render(); el.scrollTop = y; };

  async function wordRow(w) {
    const thumb = h('div', { class: 'thumb', title: 'Add a photo' });
    const u = await blobURL(w.photo);
    thumb.append(u ? h('img', { src: u, alt: '' }) : (w.emoji || '⭐'));
    const picker = photoPicker(async id => { await blobDel(w.photo); w.photo = id; await save(); rerender(); });
    thumb.onclick = () => picker.click();
    const recs = h('div', { class: 'recs' }, w.rec.en.map((r, i) => recChip(`Recording ${i + 1}`, r.id, async () => {
      w.rec.en = w.rec.en.filter(x => x.id !== r.id); await save(); rerender();
    })));
    return h('div', { class: 'wordrow' }, h('div', {}, thumb, picker),
      h('div', {},
        h('input', { type: 'text', value: w.en, placeholder: 'Word', onchange: async e => { w.en = e.target.value.trim(); await save(); } }),
        h('div', { class: 'row', style: 'margin-top:8px' },
          recButton('Record', async id => { w.rec.en.push({ id }); await save(); rerender(); }),
          h('button', { onclick: () => sayWithSound('', w) }, '🔊 Hear it'),
          h('button', { onclick: () => picker.click() }, w.photo ? '📷 Change photo' : '📷 Add photo'),
          h('button', { onclick: async () => {
            if (!confirm(`Remove "${w.en}" and its photo and recordings?`)) return;
            await blobDel(w.photo); for (const r of w.rec.en) await blobDel(r.id);
            S.words = S.words.filter(x => x !== w); await save(); rerender();
          } }, '🗑')),
        recs));
  }

  // ----- singing the songs in a family voice -----
  let active = null; // the song playing or recording right now
  const stopActive = () => { if (active) { const x = active; active = null; x.stop(); } };
  function playAlong(song, opts, lyric) {
    const a = ac(), plan = scheduleSong(song, a.currentTime + 0.8, opts), timers = [];
    const at = (t, fn) => timers.push(setTimeout(fn, Math.max(0, (t - a.currentTime) * 1000)));
    for (const c of plan.cues) at(c.at - (c.note ? 0 : 0.08), () => c.note ? lightLyric(lyric, c.note) : showLyric(lyric, c.line));
    return { plan, stop() { timers.forEach(clearTimeout); for (const n of plan.nodes) { try { n.stop(); } catch (e) {} } } };
  }
  async function recordSong(song) {
    stopActive(); stopSound();
    let st;
    try { st = await getMic(); } catch (e) { return alert('The microphone is blocked. Allow the microphone for this site, then try again.'); }
    const a = ac(); if (a.state !== 'running') await a.resume().catch(() => {});
    const lyric = h('div', { class: 'lyric' }), status = h('p', { class: 'inst-why' }, 'Get ready… Sing along when the words light up. Hold the device close.');
    const cancelBtn = h('button', { class: 'inst-x sing-cancel' }, '✕ Cancel');
    const box = h('div', { class: 'inst-modal' }, h('div', { class: 'inst-card sing-card' },
      h('h2', {}, h('span', { class: 'rec-dot' }), ` ${song.title.replace('{name}', herName())}`), status, lyric, h('div', { class: 'row', style: 'margin-top:14px' }, cancelBtn)));
    document.body.append(box);
    const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
    const rec = new MediaRecorder(st, mime ? { mimeType: mime } : undefined), chunks = [];
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise(r => { rec.onstop = () => r(new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' })); });
    await new Promise(r => { rec.onstart = r; rec.start(); setTimeout(r, 1000); });
    const recAt = a.currentTime, run = playAlong(song, { melody: 0.15 }, lyric);
    // where the count-in lands in the recording: the delay to the song, plus the time sound takes to reach the speaker and come back
    const offset = (run.plan.cues[0].at - song.meter * 60 / song.bpm) - recAt + (a.outputLatency || a.baseLatency || 0.02) + 0.03;
    let finished = false;
    const finish = async keep => {
      if (finished) return; finished = true; active = null;
      run.stop(); clearTimeout(endT); if (rec.state !== 'inactive') rec.stop();
      const blob = await done; box.remove();
      if (!keep || !blob.size) return;
      const id = uid(); await blobSet(id, blob);
      const old = S.songRec[song.id]; if (old) await blobDel(old.id);
      S.songRec[song.id] = { id, offset }; await save(); rerender();
    };
    const endT = setTimeout(() => finish(true), (run.plan.end - a.currentTime + 1) * 1000);
    cancelBtn.onclick = () => finish(false);
    active = { stop: () => finish(false) };
  }
  async function previewSong(song, btn) {
    const was = active && active.song === song.id; stopActive();
    if (was) return;
    const voice = await songVoice(song.id); if (!voice) return;
    const lyric = h('div', { class: 'lyric small' }); btn.after(lyric);
    const run = playAlong(song, { melody: 0.05, voice }, lyric);
    btn.textContent = '■ Stop';
    const end = () => { run.stop(); lyric.remove(); btn.textContent = '▶ Hear it'; clearTimeout(t); };
    const t = setTimeout(() => { if (active && active.song === song.id) active = null; end(); }, (run.plan.end - ac().currentTime + 0.5) * 1000);
    active = { song: song.id, stop: end };
  }

  async function testMic(btn) {
    btn.disabled = true; btn.textContent = '🎤 Say something now…';
    const ok = await ear.start();
    if (!ok) { btn.disabled = false; btn.textContent = '🎤 Test the microphone'; return alert('The microphone is blocked or still waiting. Click the mic icon in the address bar, choose Allow, then try again.'); }
    const heard = await ear.listen({ wait: 6000 });
    btn.disabled = false; btn.textContent = '🎤 Test the microphone';
    if (!heard) return alert("Pip didn't hear anything. Try speaking a little louder or closer to the device.");
    const u = URL.createObjectURL(heard); await playURL(u); URL.revokeObjectURL(u);
  }

  async function render() {
    const herPic = photoPicker(async id => { await blobDel(S.photo); S.photo = id; await save(); rerender(); });
    const faceU = await blobURL(S.photo);
    const nameRecs = h('div', { class: 'recs' }, S.nameRec.map(id => recChip('Her name', id, async () => { S.nameRec = S.nameRec.filter(x => x !== id); await save(); rerender(); })));
    const bdayRecs = h('div', { class: 'recs' }, S.bdayRec.map(id => recChip('Birthday message', id, async () => { S.bdayRec = S.bdayRec.filter(x => x !== id); await save(); rerender(); })));
    const herRecs = h('div', { class: 'recs' }, S.herClips.slice().reverse().map(c => recChip(`${c.word} · ${c.date}`, c.id, async () => { S.herClips = S.herClips.filter(x => x.id !== c.id); await save(); rerender(); })));
    const rows = []; for (const w of S.words) rows.push(await wordRow(w));
    const importInp = h('input', { type: 'file', accept: 'application/json,.json', style: 'display:none', onchange: e => importAll(e.target.files[0]) });
    const sample = () => robotTTS("Hello! Where's the duck? Peekaboo! Quack quack!");
    const micBtn = h('button', {}, '🎤 Test the microphone'); micBtn.onclick = () => testMic(micBtn);

    el.innerHTML = '';
    el.append(h('div', { class: 'wrap' },
      h('h1', {}, '🔒 Grown-up corner'),
      h('p', { class: 'sub' }, 'Everything you add stays on this device only. Nothing is uploaded. To come back here, hold the 🔒 in the top corner for 3 seconds.'),
      isInstalled() ? null : h('section', { class: 'install-sec' }, h('h2', {}, '📲 Install on this device'),
        h('p', { class: 'sub' }, 'Put Little World on the home screen so it opens full screen like a real app and works without internet.'),
        h('button', { class: 'primary', onclick: doInstall }, installEvt ? '📲 Install now' : '📲 Show me how')),
      !S.setupDone ? h('section', { class: 'welcome' }, h('h2', {}, 'Welcome! 🎉'),
        h('p', { class: 'sub' }, "Add her name, her photo and a few family photos, then test the microphone so Pip can hear her. You can skip anything and add more later.")) : null,

      h('section', {}, h('h2', {}, 'About her'),
        h('label', {}, 'Her name (shown on screen)'),
        h('input', { type: 'text', value: S.name, placeholder: 'Her name or nickname', onchange: async e => { S.name = e.target.value.trim(); await save(); } }),
        h('label', {}, 'Her photo (she shows up in the games too)'),
        h('div', { class: 'row' }, faceU ? h('img', { src: faceU, alt: '', style: 'width:70px;height:70px;border-radius:50%;object-fit:cover' }) : null,
          h('button', { onclick: () => herPic.click() }, faceU ? '📷 Change photo' : '📷 Add her photo'), herPic),
        h('label', {}, 'Say her name (the app greets her with your voice)'),
        h('div', { class: 'row' }, recButton('Record her name', async id => { S.nameRec.push(id); await save(); rerender(); })), nameRecs,
        h('label', {}, 'Date of birth (for the birthday countdown and birthday mode)'),
        h('input', { type: 'date', value: S.birthday, onchange: async e => { S.birthday = e.target.value; await save(); } })),

      h('section', {}, h('h2', {}, '🧸 Games on the home screen'),
        h('p', { class: 'sub' }, "Little mode shows just a few games, so she isn't faced with too many choices. Tick the games you want her to see. Family peekaboo appears once you add photos."),
        h('div', { class: 'row', style: 'margin-bottom:10px' },
          h('button', { onclick: async () => { S.show = LITTLE.slice(); await save(); rerender(); } }, '🐣 Little mode'),
          h('button', { onclick: async () => { S.show = GAMES.map(g => g[0]); await save(); rerender(); } }, '🌈 All games')),
        h('div', { class: 'game-picks' }, GAMES.map(([id, ic, label]) => h('label', { class: 'game-pick' },
          h('input', { type: 'checkbox', checked: S.show.includes(id), onchange: async e => {
            S.show = e.target.checked ? [...new Set([...S.show, id])] : S.show.filter(x => x !== id); await save();
          } }), ` ${ic === 'pip' ? '🐥' : ic} ${label}`)))),

      h('section', {}, h('h2', {}, '🎵 Sing the songs yourself'),
        h('p', { class: 'sub' }, "Press Record and sing along with the music while the words light up. Then the song plays with your voice instead of Pip's tune. It's fine to sing badly. She loves your voice most!"),
        SONGS.map(song => {
          const has = S.songRec[song.id];
          const hear = h('button', {}, '▶ Hear it'); hear.onclick = () => previewSong(song, hear);
          return h('div', { class: 'song-rec-row' },
            h('div', { class: 'song-rec-title' }, `${song.icon} ${song.title.replace('{name}', herName())}`),
            h('div', { class: 'row' },
              h('button', { class: has ? '' : 'primary', onclick: () => recordSong(song) }, has ? '🎙 Sing it again' : '🎙 Record'),
              has ? hear : null,
              has ? h('button', { title: 'Delete', onclick: async () => {
                if (!confirm('Delete your singing for this song?')) return;
                stopActive(); await blobDel(has.id); delete S.songRec[song.id]; await save(); rerender();
              } }, '🗑') : null));
        })),

      h('section', {}, h('h2', {}, '🐥 Pip listens to her'),
        h('p', { class: 'sub' }, "Pip asks her to say words and cheers when she makes any sound. At her age every try counts, so Pip doesn't check if the word is right. Test the microphone once and press Allow if the browser asks."),
        h('label', { style: 'display:flex;gap:8px;align-items:center;font-weight:400' },
          h('input', { type: 'checkbox', checked: S.listen, onchange: async e => { S.listen = e.target.checked; await save(); } }),
          'Let Pip listen (Talk with Pip, Peekaboo, My body, Feed the animals, My Words and more)'),
        h('div', { class: 'row', style: 'margin-top:8px' }, micBtn)),

      h('section', {}, h('h2', {}, '🎤 Her voice'),
        h('p', { class: 'sub' }, S.herClips.length ? 'Her tries at words, newest first. A keepsake of her first words. The oldest are removed after 80.' : 'When she says words to Pip, her little recordings appear here.'),
        h('label', { style: 'display:flex;gap:8px;align-items:center;font-weight:400' },
          h('input', { type: 'checkbox', checked: S.keepVoice, onchange: async e => { S.keepVoice = e.target.checked; await save(); } }),
          'Keep her recordings (only on this device)'),
        herRecs,
        S.herClips.length ? h('button', { style: 'margin-top:8px', onclick: async () => {
          if (!confirm('Delete all her recordings?')) return;
          for (const c of S.herClips) await blobDel(c.id); S.herClips = []; await save(); rerender();
        } }, '🗑 Delete all') : null),

      h('section', {}, h('h2', {}, 'Her words and pictures'),
        h('p', { class: 'sub' }, "These show up in all the games. Tap a picture to use your own photo, like Gogo's face or her real cup. Words with a photo also play in Family peekaboo. Animals make their sound too (Duck says \"Quack quack\"). Recording a word in your voice is optional."),
        h('div', { class: 'row', style: 'margin:12px 0' }, h('button', { class: 'primary', onclick: async () => {
          S.words.unshift({ id: uid(), en: '', emoji: '⭐', photo: null, rec: { en: [] } }); await save(); await rerender();
          const first = el.querySelector('.wordrow input'); if (first) first.focus();
        } }, '➕ Add a word')),
        rows),

      h('section', {}, h('h2', {}, "🐥 Pip's voice"),
        h('p', { class: 'sub' }, 'Tap a voice to hear it. The one you tap last is the one Pip uses.'),
        h('div', { class: 'row' }, PIP_VOICES.map(([id, label, desc]) => h('button', {
          class: S.pipVoice === id ? 'primary' : '',
          onclick: async () => {
            S.pipVoice = id; await save(); await loadVoice(id);
            el.querySelectorAll('.voice-pick').forEach(b => b.classList.toggle('primary', b.dataset.v === id));
            tts("Hello! Where's duck? Peekaboo! There's duck! Quack quack! Can you say duck? Well done!");
          }, 'data-v': id, title: desc,
        }, `▶ ${label}`)).map(b => { b.classList.add('voice-pick'); return b; }))),

      h('section', {}, h('h2', {}, '🗣️ Backup computer voice'),
        h('p', { class: 'sub' }, "Pip speaks with a natural recorded voice. This computer voice is only used for words you add yourself and haven't recorded. Your own recordings always play first."),
        h('div', { class: 'row' },
          h('select', { id: 'robot-voice', onchange: async e => { S.voice = e.target.value; await save(); sample(); } },
            h('option', { value: '' }, `Automatic (${(pickVoiceAuto() || {}).name || 'default'})`),
            niceVoices().map(v => h('option', { value: v.name, selected: v.name === S.voice }, `${v.name}${v.localService ? '' : ' (internet)'}`))),
          h('button', { onclick: sample }, '🔊 Try it'))),

      h('section', {}, h('h2', {}, '🎂 Birthday'),
        h('p', { class: 'sub' }, 'Record "Happy birthday" messages from the family. They play after she blows out the candles. Birthday mode opens by itself on her birthday.'),
        h('div', { class: 'row' }, recButton('Record a birthday message', async id => { S.bdayRec.push(id); await save(); rerender(); }),
          h('button', { onclick: () => go('birthday') }, '👀 Preview birthday mode')), bdayRecs),

      h('section', {}, h('h2', {}, '🔢 Counting'),
        h('label', {}, 'Count up to'),
        h('select', { onchange: async e => { S.countTo = +e.target.value; await save(); } },
          [[3, '3 (just starting)'], [5, '5 (good at 2 years)'], [10, '10']].map(([v, t]) => h('option', { value: v, selected: v === (S.countTo || 5) }, t)))),

      h('section', {}, h('h2', {}, 'Play time'),
        h('label', {}, 'Play time before Pip says goodnight'),
        h('select', { onchange: async e => { S.minutes = +e.target.value; await save(); } },
          [[10, '10 minutes'], [15, '15 minutes'], [20, '20 minutes'], [30, '30 minutes'], [0, 'No limit']].map(([v, t]) => h('option', { value: v, selected: v === S.minutes }, t)))),

      h('section', {}, h('h2', {}, 'Backup'),
        h('p', { class: 'sub' }, 'Save her photos and voices into one file, to keep safe or copy to another device.'),
        h('div', { class: 'row' }, h('button', { onclick: exportAll }, '💾 Save backup file'), h('button', { onclick: () => importInp.click() }, '📂 Open backup file'), importInp)),

      h('div', { class: 'done-bar' }, h('button', { class: 'primary', onclick: async () => {
        S.setupDone = true; await save(); sessionStart = null; go('splash');
      } }, '✅ Done, back to play'))));
  }

  async function exportAll() {
    const blobs = {};
    for (const id of allBlobIds()) { const b = await blobGet(id); if (b) blobs[id] = await blobToDataURL(b); }
    download(new Blob([JSON.stringify({ app: 'little-world', v: 3, settings: S, blobs })], { type: 'application/json' }),
      `${(S.name || 'little').toLowerCase()}-world-backup-${today()}.json`);
  }
  async function importAll(file) {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'little-world') throw new Error('not a backup');
      if (!confirm('Replace everything here with this backup?')) return;
      for (const [id, url] of Object.entries(data.blobs || {})) await blobSet(id, await (await fetch(url)).blob());
      S = tidy(Object.assign(defaults(), data.settings)); loadVoice(S.pipVoice); await save(); rerender(); alert('Backup restored ✅');
    } catch (e) { alert("That file isn't a Little World backup."); }
  }

  render();
  return { el, cleanup() { stopActive(); } };
};

// ---------------- start ----------------
(async () => {
  await openDB();
  S = tidy(Object.assign(defaults(), (await kvGet('settings')) || {}));
  loadVoice(S.pipVoice);
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  buildLock();
  if (location.hash === '#smoke') return smoke();
  go(S.setupDone ? 'splash' : 'grown');
})();

// Developer check: opens every screen, taps it a few times and reports errors (visit index.html#smoke).
async function smoke() {
  const out = [];
  window.addEventListener('error', e => out.push('ERR ' + e.message));
  window.addEventListener('unhandledrejection', e => out.push('REJ ' + (e.reason && e.reason.message)));
  for (const s of ['grown', 'splash', 'home', 'talk', 'copy', 'peekaboo', 'family', 'body', 'feed', 'hiding', 'words', 'colours', 'numbers', 'songs', 'paint', 'bubbles', 'piano', 'birthday', 'goodnight']) {
    try {
      go(s); await wait(400);
      for (let i = 0; i < 3; i++) { if (cur.onKey) cur.onKey({ key: 'asd'[i] }); await wait(1500); }
      out.push(s + ':ok');
    } catch (e) { out.push(s + ':FAIL ' + e.message); }
  }
  go('grown'); document.title = 'SMOKE ' + out.join(' '); console.log('SMOKE', out.join(' '));
}
