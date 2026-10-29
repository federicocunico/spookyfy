import { albumKey } from '../catalog.js';

/** Diciture di edizione che non cambiano il disco ai fini della copertina. */
const EDITION =
  /\b(remaster(ed)?|deluxe|edition|expanded|anniversary|bonus|version|reissue|special|collector'?s|mono|stereo|\d{4})\b/;

/**
 * Forma di confronto per la ricerca online: come `albumKey`, ma senza diciture di edizione
 * fra parentesi o dopo un trattino, punteggiatura e "the" iniziale.
 */
export function matchKey(s: string): string {
  let k = albumKey(s);
  k = k.replace(/[([{]([^)\]}]*)[)\]}]/g, (all, inner: string) => (EDITION.test(inner) ? ' ' : all));
  k = k.replace(/\s[-–—:]\s(.*)$/, (all, tail: string) => (EDITION.test(tail) ? '' : all));
  k = k.replace(/&/g, ' and ');
  k = k.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return k.replace(/^the /, '');
}

/** True se il candidato è lo stesso album: titolo e artista equivalenti. */
export function isConfidentMatch(
  album: { title: string; artist: string },
  candidate: { title: string; artist: string },
): boolean {
  const t = matchKey(album.title);
  const a = matchKey(album.artist);
  return t !== '' && a !== '' && t === matchKey(candidate.title) && a === matchKey(candidate.artist);
}
