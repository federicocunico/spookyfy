import { expect, test } from 'vitest';
import { SILENCE_MARGIN_MS, edgeSilenceFromPcm, trimPoints } from './silence.js';

const RATE = 1000;
/** `silenceS` secondi di silenzio, `soundS` di suono, `tailS` di silenzio (1 campione = 1 ms). */
function pcm(silenceS: number, soundS: number, tailS: number, noise = 0): Float32Array {
  const out = new Float32Array((silenceS + soundS + tailS) * RATE);
  for (let i = 0; i < out.length; i++) out[i] = i % 2 ? noise : -noise;
  out.fill(0.5, silenceS * RATE, (silenceS + soundS) * RATE);
  return out;
}

test('misura il silenzio ai bordi, su più canali', () => {
  const left = pcm(7, 60, 12);
  const right = pcm(8, 60, 11);
  expect(edgeSilenceFromPcm([left, right], RATE)).toEqual({
    leadingMs: 7000,
    trailingMs: 11000,
    durationMs: 79000,
  });
});

test('il fruscio sotto −50 dBFS conta come silenzio', () => {
  const s = edgeSilenceFromPcm([pcm(6, 30, 6, 0.002)], RATE);
  expect(s.leadingMs).toBe(6000);
  expect(s.trailingMs).toBe(6000);
});

test('oltre 5 s di silenzio si salta, lasciando un piccolo margine', () => {
  expect(trimPoints({ leadingMs: 7000, trailingMs: 12000, durationMs: 200_000 })).toEqual({
    trimStartMs: 7000 - SILENCE_MARGIN_MS,
    trimEndMs: 188_000 + SILENCE_MARGIN_MS,
  });
});

test('fino a 5 s di silenzio non si tocca nulla', () => {
  expect(trimPoints({ leadingMs: 5000, trailingMs: 3000, durationMs: 200_000 })).toEqual({});
  expect(trimPoints({ leadingMs: 9000, trailingMs: 4000, durationMs: 200_000 })).toEqual({
    trimStartMs: 8750,
  });
});

test('un brano tutto silenzioso non viene saltato per intero', () => {
  expect(trimPoints(edgeSilenceFromPcm([new Float32Array(30 * RATE)], RATE))).toEqual({});
});

test('anche un suono breve fra silenzi lunghi viene isolato', () => {
  // 7 s di silenzio, 2 s di suono, 7 s di silenzio (la fixture degli e2e).
  expect(trimPoints({ leadingMs: 7000, trailingMs: 7000, durationMs: 16_000 })).toEqual({
    trimStartMs: 6750,
    trimEndMs: 9250,
  });
});
