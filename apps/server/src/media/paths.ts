import path from 'node:path';

export type CoverSize = 512 | 128;
export const COVER_SIZES: readonly CoverSize[] = [512, 128];

/** Percorsi relativi a MEDIA_DIR, salvati nel DB. Sempre con `/`, anche su Windows. */
export const audioRelPath = (trackId: string) => `audio/${trackId}.mp3`;
export const coverRelPrefix = (trackId: string) => `covers/${trackId}`;
export const coverRelPath = (prefix: string, size: CoverSize) => `${prefix}-${size}.jpg`;

export const absMediaPath = (mediaDir: string, rel: string) => path.join(mediaDir, ...rel.split('/'));
