import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { readTags, updateTextTags, writeTags } from './tags.js';

let dir: string;
let file: string;

function silentMp3(seconds = 1): Buffer {
  const frame = Buffer.alloc(417);
  frame.set([0xff, 0xfb, 0x90, 0xc0]);
  return Buffer.concat(Array.from({ length: Math.ceil((seconds * 44100) / 1152) }, () => frame));
}

function gate<T>() {
  let release!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spookyfy-tags-'));
  file = path.join(dir, 'track.mp3');
  await fs.writeFile(file, silentMp3());
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(dir, { recursive: true, force: true });
});

describe('atomic tag updates', () => {
  test('keeps the published audio readable until the replacement is renamed', async () => {
    const audio = await fs.readFile(file);
    await writeTags(file, { title: 'Original', artist: 'Band', cover: Buffer.from('cover') });
    const original = await fs.readFile(file);
    const enteredRename = gate<void>();
    const continueRename = gate<void>();
    const realRename = fs.rename.bind(fs);
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (to === file) {
        enteredRename.release();
        await continueRename.promise;
      }
      await realRename(from, to);
    });

    const updating = updateTextTags(file, { title: 'Updated' });
    await enteredRename.promise;
    expect(await fs.readFile(file)).toEqual(original);
    expect(await readTags(file)).toMatchObject({ title: 'Original', artist: 'Band' });

    continueRename.release();
    await updating;
    const tags = await readTags(file);
    expect(tags).toMatchObject({ title: 'Updated', artist: 'Band' });
    expect((tags.image as { mime: string }).mime).toBe('image/jpeg');
    expect((tags.image as { imageBuffer: Buffer }).imageBuffer).toEqual(Buffer.from('cover'));
    const replacement = await fs.readFile(file);
    expect(replacement.subarray(-audio.length)).toEqual(audio);
    expect((await fs.readdir(dir)).sort()).toEqual(['track.mp3']);
  });

  test('preserves the published file and removes the temporary file when rename fails', async () => {
    await writeTags(file, { title: 'Original', artist: 'Band' });
    const original = await fs.readFile(file);
    const rename = vi.spyOn(fs, 'rename').mockRejectedValue(new Error('rename failed'));

    await expect(updateTextTags(file, { title: 'Updated' })).rejects.toThrow('rename failed');
    expect(await fs.readFile(file)).toEqual(original);
    expect((await fs.readdir(dir)).sort()).toEqual(['track.mp3']);
    rename.mockRestore();
    await updateTextTags(file, { title: 'Retried' });
    expect(await readTags(file)).toMatchObject({ title: 'Retried', artist: 'Band' });
  });

  test('serializes concurrent patches so neither update overwrites the other', async () => {
    await writeTags(file, { title: 'Original', artist: 'Band' });
    const enteredRename = gate<void>();
    const continueRename = gate<void>();
    const realRename = fs.rename.bind(fs);
    let paused = false;
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (to === file && !paused) {
        paused = true;
        enteredRename.release();
        await continueRename.promise;
      }
      await realRename(from, to);
    });

    const titleUpdate = updateTextTags(file, { title: 'Updated' });
    await enteredRename.promise;
    const albumUpdate = updateTextTags(file, { album: 'Album' });
    continueRename.release();
    await Promise.all([titleUpdate, albumUpdate]);

    expect(await readTags(file)).toMatchObject({ title: 'Updated', album: 'Album' });
    expect((await fs.readdir(dir)).sort()).toEqual(['track.mp3']);
  });
});
