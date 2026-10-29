import sharp from 'sharp';

export interface ProcessedCover {
  /** JPEG 512×512 da incorporare nei tag ID3. */
  large: Buffer;
  thumb: Buffer;
  dominantColor: string;
}

const toHex = (n: number) =>
  Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, '0');
export const rgbToHex = (r: number, g: number, b: number) => `#${toHex(r)}${toHex(g)}${toHex(b)}`;

/** Copertina di riserva quando la sorgente non fornisce una miniatura. */
function placeholder(): sharp.Sharp {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#b69cff"/><stop offset="1" stop-color="#262233"/></linearGradient></defs>
    <rect width="512" height="512" fill="url(#g)"/></svg>`;
  return sharp(Buffer.from(svg));
}

/**
 * Ritaglia la copertina in quadrati 512 e 128 px (centrati) e ne calcola il
 * colore dominante, salvato col brano per colorare l'interfaccia senza attese.
 */
export async function processCover(input: Buffer | string | undefined): Promise<ProcessedCover> {
  const source = input ? sharp(input) : placeholder();
  const square = await source
    .clone()
    .resize(512, 512, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
  const thumb = await sharp(square).resize(128, 128).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  const { dominant } = await sharp(square).stats();
  return { large: square, thumb, dominantColor: rgbToHex(dominant.r, dominant.g, dominant.b) };
}
