// Genera le icone della PWA in public/icons a partire dal fantasmino Spookyfy.
// Uso: pnpm --filter @spookyfy/web icons
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const out = path.resolve(import.meta.dirname, '../public/icons');
fs.mkdirSync(out, { recursive: true });

const BG = '#121212';
const ACCENT = '#FF5F1F';
const ghost = (fill) => `
  <path fill="${fill}" d="M120 236 C120 156 176 96 256 96 C336 96 392 156 392 236 V400 L358 372 L324 400 L290 372
    L256 400 L222 372 L188 400 L154 372 L120 400 Z"/>
  <ellipse cx="212" cy="236" rx="22" ry="30" fill="${BG}"/>
  <ellipse cx="300" cy="236" rx="22" ry="30" fill="${BG}"/>`;

/** scale: quota del lato occupata dal fantasmino; rounded: angoli arrotondati (icone "any"). */
const svg = ({ scale = 1, rounded = false } = {}) => {
  const t = (512 * (1 - scale)) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
    <rect width="512" height="512" rx="${rounded ? 112 : 0}" fill="${BG}"/>
    <g transform="translate(${t + 8 * scale} ${t + 8 * scale}) scale(${scale})">${ghost(ACCENT)}</g>
  </svg>`;
};

const targets = [
  { file: 'icon-192.png', size: 192, svg: svg({ scale: 0.92, rounded: true }) },
  { file: 'icon-512.png', size: 512, svg: svg({ scale: 0.92, rounded: true }) },
  // Maskable: contenuto entro la "safe zone" (cerchio dell'80%).
  { file: 'maskable-512.png', size: 512, svg: svg({ scale: 0.62 }) },
  // iOS arrotonda da sé gli angoli e non accetta trasparenze.
  { file: 'apple-touch-icon.png', size: 180, svg: svg({ scale: 0.78 }) },
];

for (const t of targets) {
  await sharp(Buffer.from(t.svg)).resize(t.size, t.size).png().toFile(path.join(out, t.file));
}
fs.writeFileSync(path.join(out, 'favicon.svg'), svg({ scale: 0.92, rounded: true }));
console.log(`Icone generate in ${out}`);
