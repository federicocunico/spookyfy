/**
 * Colore stabile per un genere (stesso nome, stesso colore), scelto fra tinte scure
 * che reggono il testo bianco come le copertine.
 */
const PALETTE = [
  '#6b3fa0',
  '#a03f6b',
  '#3f6ba0',
  '#2f7d6b',
  '#a0603f',
  '#5a5fa8',
  '#8a3fa0',
  '#3f8aa0',
  '#7d5a2f',
  '#a03f3f',
];

export function genreColor(name: string): string {
  let h = 0;
  for (const c of name.toLocaleLowerCase('it')) h = (h * 31 + c.codePointAt(0)!) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}
