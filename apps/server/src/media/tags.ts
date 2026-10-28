import NodeID3 from 'node-id3';

export interface TrackTags {
  title: string;
  artist: string;
  album?: string | null;
  /** Copertina JPEG da incorporare (frame APIC "Front cover"). */
  cover?: Buffer;
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

/** Scrive da zero i tag ID3 del file (sostituisce quelli esistenti). */
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
  await NodeID3.Promise.update(patch, file);
}

export async function readTags(file: string): Promise<NodeID3.Tags> {
  return NodeID3.Promise.read(file);
}
