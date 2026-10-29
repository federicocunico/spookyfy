import type { AlbumDto, TrackDto } from '@spookyfy/shared';

export interface TrackMenuState {
  track: TrackDto;
  /** Presenti quando il menu è aperto da una playlist: abilitano "Rimuovi da questa playlist". */
  playlistId?: string;
  itemId?: string;
}

export interface PromptState {
  title: string;
  label: string;
  value: string;
  confirmLabel: string;
  submit(value: string): Promise<void>;
}

export interface ConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  confirm(): Promise<void> | void;
}

/** Stato di menu e dialoghi globali (montati una sola volta in App). */
export class Ui {
  menu = $state<TrackMenuState | null>(null);
  addToPlaylist = $state<TrackDto | null>(null);
  editTrack = $state<TrackDto | null>(null);
  /** Album: modifica di titolo, artista, anno e generi; scelta della copertina. */
  editAlbum = $state<AlbumDto | null>(null);
  albumCover = $state<AlbumDto | null>(null);
  /** Brano da inserire in un album (selettore con ricerca e "Nuovo album"). */
  addToAlbum = $state<TrackDto | null>(null);
  /** Brano senza album da cercare online. */
  lookupTrack = $state<TrackDto | null>(null);
  prompt = $state<PromptState | null>(null);
  confirm = $state<ConfirmState | null>(null);
  queueOpen = $state(false);

  closeAll(): void {
    this.menu = null;
    this.addToPlaylist = null;
    this.editTrack = null;
    this.editAlbum = null;
    this.albumCover = null;
    this.addToAlbum = null;
    this.lookupTrack = null;
    this.prompt = null;
    this.confirm = null;
  }
}
