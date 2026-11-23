// Makes Pip's natural voice: one short audio clip per phrase, saved in voice/ with voice/index.json.
// Uses ElevenLabs. The API key is read from ~/.config/little-world/elevenlabs-key and is never printed or saved here.
//
//   node tools/make-voice.mjs --samples <outdir>   one test sentence in a few voices, to choose from
//   node tools/make-voice.mjs --voice <voiceId> --name <name>   make every clip into voice/<name>/ (skips existing)
//   add --force to remake existing clips
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'voice');
const KEY = readFileSync(join(homedir(), '.config/little-world/elevenlabs-key'), 'utf8').trim();
const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };

// Everything Pip can say, written the way it should sound.
const PHRASES = [
  // greetings and prompts
  'Hello!', "Where's", "There's", 'Look!', "Look! It's", 'Peekaboo!', 'There you are!', 'Can you say', 'Can you say your name?',
  'Say it with me.', 'Can you say it?', 'Your turn!', "Let's talk!", 'Listen to you!', "Who's hiding?", 'Tap!', 'Tap me!',
  // praise
  'Yay! You said it!', 'Well done!', 'Wow, clever!', 'Yes! Good talking!', 'Yes!', 'Good talking!', 'Wow!',
  'Well done! You counted them all!', 'Yay! Clever counting!',
  // copy me and bubbles
  "Say something! I'll copy you!", 'Say something!', 'Hello? Talk to me!', 'Can you sing?', 'I hear you!', 'Yay! Talk to me!',
  'What a big voice!', 'Pop!', 'Pop pop!', 'Wheee!',
  // counting
  "Let's count", 'One!', 'Two!', 'Three!', 'Four!', 'Five!', 'Six!', 'Seven!', 'Eight!', 'Nine!', 'Ten!',
  // birthday and goodnight
  'Happy birthday!', "Let's blow out the candles!", 'You are', 'All done for now.', 'Night night!',
  // home screen buttons
  'Talk with Pip', 'Copy me', 'My Words', 'Counting', 'Paint', 'Bubbles', 'Animals', 'Birthday',
  // songs
  'Songs', "Let's sing!", 'Lovely singing!', 'Yay!', 'Twinkle Twinkle', 'Old MacDonald', 'Itsy Bitsy Spider', 'Row Your Boat',
  // starter words
  'Mama!', 'Daddy!', 'Gogo!', 'Baby!', 'Dog!', 'Cat!', 'Ball!', 'Cup!', 'Shoes!', 'Car!', 'Water!', 'Milk!', 'Banana!', 'Book!',
  'Bird!', 'Cow!', 'Sun!', 'Moon!', 'Hat!', 'Bath!', 'Teddy!', 'Duck!', 'Chicken!', 'Frog!', 'Elephant!', 'Lion!',
  // counting things
  'Ducks!', 'Balls!', 'Star!', 'Stars!', 'Apple!', 'Apples!', 'Cars!', 'Fish!', 'Balloon!', 'Balloons!', 'Dogs!', 'Bananas!',
  // animal and other sounds
  'Woof woof!', 'Meow!', 'Moo!', 'Quack quack!', 'Tweet tweet!', 'Cluck cluck!', 'Ribbit!', 'Roar!', 'Toot toot!', 'Baa baa!',
  'Oink oink!', 'Neigh!', 'Meh meh!', 'Hoo hoo!', 'Buzz buzz!', 'Hiss!', 'Ooh ooh ah ah!', 'Squeak squeak!', 'Beep beep!',
  'Choo choo!', 'Waa waa!',
];
const norm = s => s.toLowerCase().replace(/’/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
const slug = s => norm(s).replace(/'/g, '').replace(/ /g, '-');

async function speak(voice, text) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_64`, {
      method: 'POST',
      headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify({
        text, model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.3, use_speaker_boost: true, speed: 0.92 },
      }),
    });
    if (r.ok) return Buffer.from(await r.arrayBuffer());
    const msg = (await r.text()).slice(0, 300);
    if (r.status === 429 || r.status >= 500) { await new Promise(res => setTimeout(res, 2000 * attempt)); continue; }
    throw new Error(`ElevenLabs ${r.status}: ${msg}`);
  }
  throw new Error('ElevenLabs kept refusing (too many requests). Try again in a minute.');
}

if (args.includes('--samples')) {
  const dir = opt('--samples');
  mkdirSync(dir, { recursive: true });
  const r = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': KEY } });
  if (!r.ok) throw new Error(`Could not list voices (${r.status}). Check the key has "Voices: read" permission.`);
  const { voices } = await r.json();
  const want = ['Matilda', 'Jessica', 'Lily', 'Sarah', 'Alice', 'Charlotte', 'Laura'];
  const chosen = want.map(n => voices.find(v => v.name.startsWith(n))).filter(Boolean).slice(0, 5);
  const list = chosen.length ? chosen : voices.slice(0, 5);
  for (const v of list) {
    const audio = await speak(v.voice_id, "Hello! Where's the duck? Peekaboo! There's the duck! Quack quack! Can you say duck? Well done!");
    const file = join(dir, `${v.name.split(' ')[0].toLowerCase()}.mp3`);
    writeFileSync(file, audio);
    console.log(`${v.name.split(' ')[0]}\t${v.voice_id}\t${file}`);
  }
} else {
  const voice = opt('--voice'), name = opt('--name');
  if (!voice || !name) throw new Error('Pass --voice <voiceId> --name <name>, or --samples <dir>');
  const dir = join(OUT, name);
  mkdirSync(dir, { recursive: true });
  const index = {};
  let made = 0;
  for (const text of PHRASES) {
    const key = norm(text), file = `${slug(text)}.mp3`;
    index[key] = file;
    if (existsSync(join(dir, file)) && !args.includes('--force')) continue;
    writeFileSync(join(dir, file), await speak(voice, text));
    made++; process.stdout.write('.');
  }
  writeFileSync(join(dir, 'index.json'), JSON.stringify(index, null, 1));
  console.log(`\n${name}: made ${made} new clips; ${Object.keys(index).length} phrases`);
}
