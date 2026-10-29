import fs from 'node:fs';
import path from 'node:path';

const css = fs.readFileSync(path.resolve(__dirname, 'app.css'), 'utf8');

function token(name: string): string {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (!m?.[1]) throw new Error(`token --${name} mancante`);
  return m[1];
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

test('palette Spookyfy', () => {
  expect(token('bg').toLowerCase()).toBe('#0b0a10');
  expect(token('surface-1').toLowerCase()).toBe('#14121b');
  expect(token('surface-3').toLowerCase()).toBe('#262233');
  expect(token('accent').toLowerCase()).toBe('#b69cff');
});

test.each(['text', 'text-2', 'text-3'])('contrasto di --%s su sfondo e superfici ≥ 4.5:1', (name) => {
  for (const bg of ['bg', 'surface-1', 'surface-3']) {
    expect(contrast(token(name), token(bg))).toBeGreaterThanOrEqual(4.5);
  }
});

test('testo sui bottoni in accento leggibile', () => {
  expect(contrast(token('accent-ink'), token('accent'))).toBeGreaterThanOrEqual(4.5);
  expect(contrast(token('accent-ink'), token('downloaded'))).toBeGreaterThanOrEqual(4.5);
});

test('accento leggibile come testo su sfondo e superfici', () => {
  for (const bg of ['bg', 'surface-1', 'surface-3']) {
    expect(contrast(token('accent'), token(bg))).toBeGreaterThanOrEqual(4.5);
  }
});

test('errore leggibile su sfondo e superfici', () => {
  for (const bg of ['bg', 'surface-1', 'surface-3']) {
    expect(contrast(token('danger'), token(bg))).toBeGreaterThanOrEqual(4.5);
  }
});
