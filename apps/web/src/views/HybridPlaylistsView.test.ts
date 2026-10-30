import type { HybridPlaylistDto } from '@spookyfy/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { expect, test, vi } from 'vitest';
import HybridPlaylistsView from './HybridPlaylistsView.svelte';
test('occurrence controls use occurrence IDs and copy is explicit', async () => {
  const p: HybridPlaylistDto = {
    id: 'p',
    ownerId: 'owner',
    name: 'Mixed',
    createdAt: 1,
    updatedAt: 1,
    items: [
      { itemId: 'first', ref: { provider: 'local', trackId: 't' }, addedAt: 1 },
      { itemId: 'duplicate', ref: { provider: 'local', trackId: 't' }, addedAt: 1 },
    ],
  };
  const repository = {
    list: vi.fn(async () => [p]),
    get: vi.fn(async () => p),
    create: vi.fn(async () => p),
    rename: vi.fn(async () => p),
    add: vi.fn(async () => p),
    move: vi.fn(async () => p),
    remove: vi.fn(async () => p),
    delete: vi.fn(async () => {}),
    copyLegacy: vi.fn(async () => p),
    copySpotify: vi.fn(async () => ({ playlist: p, excluded: 0 })),
  };
  render(HybridPlaylistsView, { repository, legacyPlaylists: [{ id: 'old', name: 'Legacy' }] });
  await screen.findByRole('heading', { name: 'Mixed' });
  await fireEvent.click(screen.getByRole('button', { name: 'Rimuovi occorrenza 2 da Mixed' }));
  expect(repository.remove).toHaveBeenCalledWith('p', 'duplicate');
  await fireEvent.click(screen.getByRole('button', { name: 'Sposta su 2 di Mixed' }));
  expect(repository.move).toHaveBeenCalledWith('p', 'duplicate', 0);
  expect(repository.copyLegacy).not.toHaveBeenCalled();
  await fireEvent.click(screen.getByRole('button', { name: 'Copia Legacy' }));
  await waitFor(() => expect(repository.copyLegacy).toHaveBeenCalledWith('old'));
});
