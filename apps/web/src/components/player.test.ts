import { fireEvent, render, screen } from '@testing-library/svelte';
import { type TestServices, flush, makeTrack, setupServices } from '../test/fixtures';
import FullPlayer from './FullPlayer.svelte';
import Marquee from './Marquee.svelte';
import MiniPlayer from './MiniPlayer.svelte';
import ScrubBar from './ScrubBar.svelte';
import UpdatePrompt from './UpdatePrompt.svelte';

let s: TestServices;
let audio: HTMLAudioElement;
beforeEach(async () => {
  s = await setupServices();
  audio = document.createElement('audio');
  s.player.attach(audio);
});
afterEach(() => {
  s.player.detach();
  vi.restoreAllMocks();
});

/** jsdom non calcola il layout: misure finte per scrollWidth/clientWidth. */
function fakeWidths(content: number, box: number) {
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(content);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(box);
}

describe('marquee', () => {
  test('titolo lungo: scorre', () => {
    fakeWidths(600, 200);
    const { container } = render(Marquee, { text: 'Un titolo lunghissimo che non entra' });
    expect(container.querySelector('.marquee')).toHaveAttribute('data-overflowing', 'true');
    expect(container.querySelector('.track')).toHaveClass('scrolling');
  });

  test('titolo corto: resta fermo', () => {
    fakeWidths(120, 200);
    const { container } = render(Marquee, { text: 'Corto' });
    expect(container.querySelector('.marquee')).toHaveAttribute('data-overflowing', 'false');
    expect(container.querySelector('.track')).not.toHaveClass('scrolling');
  });
});

describe('mini-player', () => {
  test('copertina, titolo, play/pausa e barra di avanzamento sottile', async () => {
    const t = makeTrack({ title: 'Song', artist: 'Band', durationMs: 200_000 });
    s.player.playTracks([t], 0);
    render(MiniPlayer);
    expect(screen.getByTestId('mini-player')).toHaveAccessibleName(/Song di Band/);
    expect(screen.getByRole('button', { name: 'Pausa' })).toBeInTheDocument();
    Object.defineProperty(audio, 'currentTime', { value: 50, configurable: true });
    audio.dispatchEvent(new Event('timeupdate'));
    await flush();
    const bar = document.querySelector<HTMLElement>('.progress .bar')!;
    expect(bar.style.transform).toBe('scaleX(0.25)');
    await fireEvent.click(screen.getByRole('button', { name: 'Pausa' }));
    expect(s.player.playing).toBe(false);
  });

  test('tap apre il player a schermo intero, swipe verso l’alto anche', async () => {
    s.player.playTracks([makeTrack()], 0);
    render(MiniPlayer);
    const mini = screen.getByTestId('mini-player');
    await fireEvent.pointerDown(mini, { clientY: 700 });
    await fireEvent.pointerUp(mini, { clientY: 702 });
    expect(s.router.overlay).toBe('player');
    s.router.closeOverlay();
    await new Promise((r) => setTimeout(r, 20));
    expect(s.router.overlay).toBeNull();
    await fireEvent.pointerDown(mini, { clientY: 700 });
    await fireEvent.pointerMove(mini, { clientY: 640 });
    await fireEvent.pointerUp(mini, { clientY: 620 });
    expect(s.router.overlay).toBe('player');
  });

  test('non c’è senza un brano corrente', () => {
    render(MiniPlayer);
    expect(screen.queryByTestId('mini-player')).toBeNull();
  });
});

describe('barra di avanzamento', () => {
  function setup() {
    const onseek = vi.fn();
    render(ScrubBar, { position: 60, duration: 240, onseek });
    const slider = screen.getByRole('slider');
    vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 400,
      top: 0,
      height: 44,
    } as DOMRect);
    return { onseek, slider };
  }

  test('il seek avviene solo al rilascio, con anteprima del tempo durante il trascinamento', async () => {
    const { onseek, slider } = setup();
    await fireEvent.pointerDown(slider, { clientX: 100 });
    await fireEvent.pointerMove(slider, { clientX: 300 });
    expect(onseek).not.toHaveBeenCalled();
    expect(screen.getByTestId('elapsed')).toHaveTextContent('3:00');
    await fireEvent.pointerUp(slider, { clientX: 300 });
    expect(onseek).toHaveBeenCalledTimes(1);
    expect(onseek).toHaveBeenCalledWith(180);
  });

  test('frecce da tastiera', async () => {
    const { onseek, slider } = setup();
    await fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(onseek).toHaveBeenCalledWith(65);
  });
});

describe('player a schermo intero', () => {
  test('sfondo dal colore dominante, controlli e chiusura con Indietro', async () => {
    const t = makeTrack({ dominantColor: '#d02020', title: 'Rosso' });
    s.player.playTracks([t], 0);
    render(FullPlayer);
    expect(screen.queryByTestId('full-player')).toBeNull();
    s.router.openOverlay('player');
    await flush();
    const panel = screen.getByTestId('full-player');
    expect(panel.style.getPropertyValue('--tint')).toBe('#d02020');
    for (const name of [
      'Shuffle',
      'Brano precedente',
      'Pausa',
      'Brano successivo',
      'Ripeti disattivato',
      'Aggiungi ai preferiti',
      'Scarica',
    ]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    await fireEvent.click(screen.getByRole('button', { name: 'Ripeti disattivato' }));
    expect(s.player.repeat).toBe('all');

    const popped = new Promise((r) => window.addEventListener('popstate', r, { once: true }));
    window.history.back();
    await popped;
    await flush();
    expect(screen.queryByTestId('full-player')).toBeNull();
    expect(s.player.playing).toBe(true);
  });
});

describe('aggiornamento dell’app', () => {
  test('avviso durante la riproduzione senza interromperla', async () => {
    s.player.playTracks([makeTrack()], 0);
    const update = vi.fn();
    render(UpdatePrompt, { update });
    expect(screen.getByTestId('update-prompt')).toHaveTextContent('Nuova versione');
    expect(s.player.playing).toBe(true);
    await fireEvent.click(screen.getByRole('button', { name: /Aggiorna/ }));
    expect(update).toHaveBeenCalled();
  });

  test('nessun avviso senza aggiornamenti', () => {
    render(UpdatePrompt, { update: null });
    expect(screen.queryByTestId('update-prompt')).toBeNull();
  });
});
