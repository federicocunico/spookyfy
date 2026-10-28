// yt-dlp finto per i test: simula ricerca, download, avanzamento ed errori
// in base alla query o al prefisso dell'id del video.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const args = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const arg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

function silentMp3(seconds) {
  const frame = Buffer.alloc(417);
  frame.set([0xff, 0xfb, 0x90, 0xc0]);
  return Buffer.concat(Array.from({ length: Math.ceil((seconds * 44100) / 1152) }, () => frame));
}

async function search() {
  const q = args.at(-1).replace(/^ytsearch\d+:/, '');
  if (q.includes('timeout')) await sleep(60_000);
  if (q.includes('fail')) {
    process.stderr.write('ERROR: Unable to download API page: HTTP Error 429\n');
    process.exit(1);
  }
  const entries = Array.from({ length: 12 }, (_, i) => ({
    id: `${'srch'}${String(i).padStart(7, '0')}`,
    title: `${q} risultato ${i}`,
    channel: `Canale ${i}`,
    duration: 180 + i,
    thumbnails: [{ url: `https://i.ytimg.com/vi/x${i}/default.jpg` }],
  }));
  entries.push({ id: 'diretta0000', title: 'diretta', live_status: 'is_live' });
  process.stdout.write(JSON.stringify({ _type: 'playlist', entries }));
}

async function download() {
  const url = args.at(-1);
  const id = new URL(url).searchParams.get('v');
  const outDir = path.dirname(arg('-o'));
  fs.mkdirSync(outDir, { recursive: true });
  const progress = async (steps, delay) => {
    for (let i = 0; i <= steps; i++) {
      process.stdout.write(`spk-progress ${((i / steps) * 100).toFixed(1)}%\n`);
      await sleep(delay);
    }
  };

  if (id.startsWith('unavail')) {
    process.stderr.write(`ERROR: [youtube] ${id}: Video unavailable\n`);
    process.exit(1);
  }
  if (id.startsWith('toolong')) {
    process.stdout.write(`[download] Lungo: ${id} does not pass filter (duration <= 1200), skipping ..\n`);
    process.exit(0);
  }
  if (id.startsWith('flaky')) {
    const marker = path.join(path.dirname(outDir), `flaky-${id}`);
    if (!fs.existsSync(marker)) {
      fs.writeFileSync(marker, '1');
      fs.writeFileSync(path.join(outDir, `${id}.part`), 'parziale');
      process.stderr.write('ERROR: Read timed out\n');
      process.exit(1);
    }
  }
  if (id.startsWith('slow')) await progress(20, 100);
  else await progress(4, 10);

  fs.writeFileSync(path.join(outDir, `${id}.mp3`), silentMp3(3));
  const jpg = await sharp({ create: { width: 480, height: 360, channels: 3, background: '#d02020' } })
    .jpeg()
    .toBuffer();
  fs.writeFileSync(path.join(outDir, `${id}.jpg`), jpg);
  const info = id.startsWith('topic')
    ? {
        id,
        title: 'Come As You Are',
        track: 'Come As You Are',
        artist: 'Nirvana',
        album: 'Nevermind',
        uploader: 'Nirvana - Topic',
        duration: 3,
      }
    : {
        id,
        title: `Canzone ${id} (Official Video)`,
        uploader: 'Band Finta',
        channel: 'Band Finta',
        duration: 3,
      };
  fs.writeFileSync(path.join(outDir, `${id}.info.json`), JSON.stringify(info));
}

if (args.includes('--flat-playlist')) await search();
else await download();
