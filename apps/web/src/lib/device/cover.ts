export interface ProcessedCover {
  large: Blob;
  thumb: Blob;
  dominantColor: string;
}

export type CoverProcessor = (source: Blob | null) => Promise<ProcessedCover>;

const hex = (n: number) =>
  Math.round(Math.max(0, Math.min(255, n)))
    .toString(16)
    .padStart(2, '0');

/** Colore medio dei pixel "colorati" (esclusi quasi neri e quasi bianchi). */
export function dominantColor(data: Uint8ClampedArray): string {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const [pr, pg, pb] = [data[i]!, data[i + 1]!, data[i + 2]!];
    const max = Math.max(pr, pg, pb);
    const min = Math.min(pr, pg, pb);
    if (max < 24 || min > 232) continue;
    r += pr;
    g += pg;
    b += pb;
    n++;
  }
  if (n === 0) return '#3a3a3a';
  return `#${hex(r / n)}${hex(g / n)}${hex(b / n)}`;
}

function canvas(size: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(size, size);
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

async function toJpeg(c: HTMLCanvasElement | OffscreenCanvas, quality = 0.86): Promise<Blob> {
  if ('convertToBlob' in c) return c.convertToBlob({ type: 'image/jpeg', quality });
  return new Promise((resolve, reject) =>
    c.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Conversione JPEG non riuscita'))),
      'image/jpeg',
      quality,
    ),
  );
}

function drawPlaceholder(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, size: number) {
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, '#ff5f1f');
  g.addColorStop(1, '#282828');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
}

/**
 * Ritaglio quadrato centrato a 512 e 128 px e colore dominante, nel browser.
 * Senza immagine (file senza copertina) produce la copertina predefinita.
 */
export const processCover: CoverProcessor = async (source) => {
  const bitmap = source ? await createImageBitmap(source).catch(() => null) : null;
  const render = async (size: number) => {
    const c = canvas(size);
    const ctx = c.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    if (bitmap) {
      const side = Math.min(bitmap.width, bitmap.height);
      const sx = (bitmap.width - side) / 2;
      const sy = (bitmap.height - side) / 2;
      ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size);
    } else {
      drawPlaceholder(ctx, size);
    }
    return { c, ctx };
  };
  const large = await render(512);
  const thumb = await render(128);
  const small = await render(32);
  const color = dominantColor(small.ctx.getImageData(0, 0, 32, 32).data);
  bitmap?.close();
  return { large: await toJpeg(large.c), thumb: await toJpeg(thumb.c, 0.8), dominantColor: color };
};
