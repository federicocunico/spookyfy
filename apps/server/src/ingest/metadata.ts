import type { YtInfo } from './ytdlp.js';

export interface CleanMetadata {
  title: string;
  artist: string;
  album: string | null;
}

// Parentesi con indicazioni "di confezione" del video, da togliere dal titolo.
const NOISE_WORDS = [
  'official\\s+(?:music\\s+|lyric\\s+|hd\\s+|4k\\s+)?(?:video|audio|visuali[sz]er|clip)',
  'official',
  'music\\s+video',
  'lyric(?:s)?(?:\\s+video)?',
  'with\\s+lyrics',
  'audio(?:\\s+only)?',
  'video(?:\\s+ufficiale)?',
  'videoclip(?:\\s+ufficiale)?',
  'ufficiale',
  'testo',
  'visuali[sz]er',
  'hd|hq|4k|1080p|720p',
];
const BRACKETED_NOISE = new RegExp(`\\s*[\\(\\[]\\s*(?:${NOISE_WORDS.join('|')})\\s*[\\)\\]]`, 'gi');
const TRAILING_NOISE = new RegExp(`\\s*(?:\\||-)\\s*(?:${NOISE_WORDS.join('|')})\\s*$`, 'i');

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

export function cleanTitle(title: string): string {
  let t = title.replace(BRACKETED_NOISE, '');
  t = t.replace(TRAILING_NOISE, '');
  t = collapse(t);
  // "Titolo" tra virgolette (stile "Artista - "Titolo"").
  const quoted = /^["“'](.+)["”']$/.exec(t);
  if (quoted?.[1]) t = quoted[1].trim();
  return t || collapse(title);
}

export function cleanChannel(channel: string): string {
  return collapse(
    channel
      .replace(/\s*-\s*topic$/i, '')
      .replace(/vevo$/i, '')
      .replace(/\s*(?:official|officiel|ufficiale)(?:\s+(?:channel|canale|youtube))?$/i, ''),
  );
}

/**
 * Titolo/artista per la libreria: i campi musicali di YouTube Music (`track`,
 * `artist`) se presenti, altrimenti titolo e canale ripuliti, con la forma
 * comune "Artista - Titolo" separata nei due campi.
 */
export function cleanMetadata(info: YtInfo): CleanMetadata {
  const album = info.album?.trim() || null;
  const artistField = info.artist?.trim() || info.artists?.filter(Boolean).join(', ');
  if (info.track?.trim() && artistField) {
    return { title: cleanTitle(info.track), artist: artistField, album };
  }

  const rawTitle = collapse(info.title ?? info.id);
  const channel = cleanChannel(info.channel ?? info.uploader ?? '');
  const dash = /^(.+?)\s+[-–—]\s+(.+)$/.exec(rawTitle);
  if (dash?.[1] && dash[2]) {
    return { title: cleanTitle(dash[2]), artist: collapse(dash[1]), album };
  }
  return { title: cleanTitle(rawTitle), artist: channel || 'Artista sconosciuto', album };
}
