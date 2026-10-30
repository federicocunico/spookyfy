import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import NodeID3 from 'node-id3';

export interface TrackTags {
  title: string;
  artist: string;
  album?: string | null;
  /** Copertina JPEG da incorporare (frame APIC "Front cover"). */
  cover?: Buffer;
}

const updates = new Map<string, Promise<number>>();

/** Replaces tags without exposing a truncated or partially written published file. */
export function updateTagsAtomically(file: string, tags: NodeID3.Tags): Promise<number> {
  const key = path.resolve(file);
  const previous = updates.get(key) ?? Promise.resolve(0);
  const current = previous
    .catch(() => 0)
    .then(async () => {
      const stat = await fs.stat(key);
      const original = await fs.readFile(key);
      const updated = NodeID3.update(tags, original);
      if (!Buffer.isBuffer(updated)) throw new Error('Aggiornamento ID3 non riuscito');

      const temp = path.join(path.dirname(key), `.${path.basename(key)}.${randomUUID()}.tmp`);
      try {
        await fs.writeFile(temp, updated, { flag: 'wx', mode: stat.mode & 0o777 });
        await fs.chmod(temp, stat.mode & 0o777).catch(() => {});
        await fs.rename(temp, key);
        return updated.length;
      } catch (err) {
        await fs.rm(temp, { force: true }).catch(() => {});
        throw err;
      }
    });
  updates.set(key, current);
  void current
    .finally(() => {
      if (updates.get(key) === current) updates.delete(key);
    })
    .catch(() => {});
  return current;
}

function toId3(tags: TrackTags): NodeID3.Tags {
  const out: NodeID3.Tags = { title: tags.title, artist: tags.artist, album: tags.album ?? '' };
  if (tags.cover) {
    out.image = {
      mime: 'image/jpeg',
      type: { id: 3, name: 'front cover' },
      description: 'Cover',
      imageBuffer: tags.cover,
    };
  }
  return out;
}

/** Scrive i tag dei file di lavoro dell'importazione; per file pubblicati usare l'update atomico. */
export async function writeTags(file: string, tags: TrackTags): Promise<void> {
  await NodeID3.Promise.write(toId3(tags), file);
}

/** Aggiorna titolo/artista/album lasciando intatti gli altri frame (es. la copertina). */
export async function updateTextTags(
  file: string,
  tags: { title?: string; artist?: string; album?: string | null },
): Promise<void> {
  const patch: NodeID3.Tags = {};
  if (tags.title !== undefined) patch.title = tags.title;
  if (tags.artist !== undefined) patch.artist = tags.artist;
  if (tags.album !== undefined) patch.album = tags.album ?? '';
  await updateTagsAtomically(file, patch);
}

export async function readTags(file: string): Promise<NodeID3.Tags> {
  return NodeID3.Promise.read(file);
}
