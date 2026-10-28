import {
  createQueue,
  currentId,
  cycleRepeat,
  jumpTo,
  next,
  playNext,
  previous,
  removeTrack,
  setShuffle,
  upcoming,
} from './queue';

const ten = Array.from({ length: 10 }, (_, i) => `t${i + 1}`);
/** Generatore deterministico per i test dello shuffle. */
const seeded = (initial = 42) => {
  let seed = initial;
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
};

test('avvio dal terzo brano di una playlist da 10', () => {
  const q = createQueue(ten, 2, { context: 'playlist:p1' });
  expect(currentId(q)).toBe('t3');
  expect(upcoming(q)).toEqual(['t4', 't5', 't6', 't7', 't8', 't9', 't10']);
});

test('riproduci dopo: subito dopo il brano corrente', () => {
  let q = createQueue(['a', 'b', 'c'], 0);
  q = playNext(q, 'x');
  expect(upcoming(q)).toEqual(['x', 'b', 'c']);
  q = playNext(q, 'y');
  expect(upcoming(q)).toEqual(['y', 'x', 'b', 'c']);
  expect(currentId(next(q).queue)).toBe('y');
});

test('riproduci dopo con lo shuffle attivo', () => {
  let q = createQueue(['a', 'b', 'c', 'd'], 1, { shuffle: true, rng: seeded() });
  q = playNext(q, 'x');
  expect(upcoming(q)[0]).toBe('x');
  expect(currentId(q)).toBe('b');
});

describe('precedente', () => {
  test('oltre 3 secondi riparte il brano', () => {
    const q = createQueue(ten, 4);
    const step = previous(q, 40);
    expect(step.restart).toBe(true);
    expect(currentId(step.queue)).toBe('t5');
  });

  test('entro 3 secondi va al brano precedente', () => {
    const q = createQueue(ten, 4);
    const step = previous(q, 2);
    expect(step.restart).toBe(false);
    expect(currentId(step.queue)).toBe('t4');
  });

  test('sul primo brano riparte', () => {
    expect(previous(createQueue(ten, 0), 1).restart).toBe(true);
  });
});

describe('repeat', () => {
  test('ripeti coda: dopo l’ultimo riparte dal primo', () => {
    const q = createQueue(['a', 'b'], 1, { repeat: 'all' });
    const step = next(q, { auto: true });
    expect(step.play).toBe(true);
    expect(currentId(step.queue)).toBe('a');
  });

  test('ripeti brano: lo stesso brano riparte alla fine naturale', () => {
    const q = createQueue(['a', 'b'], 0, { repeat: 'one' });
    expect(currentId(next(q, { auto: true }).queue)).toBe('a');
    // Il tasto "successivo" invece avanza.
    expect(currentId(next(q).queue)).toBe('b');
  });

  test('fine coda senza repeat: stop sull’ultimo brano', () => {
    const q = createQueue(['a', 'b'], 1);
    const step = next(q, { auto: true });
    expect(step.play).toBe(false);
    expect(currentId(step.queue)).toBe('b');
  });

  test('ciclo off → all → one → off', () => {
    expect(cycleRepeat('off')).toBe('all');
    expect(cycleRepeat('all')).toBe('one');
    expect(cycleRepeat('one')).toBe('off');
  });
});

describe('shuffle', () => {
  test('mescola solo la parte restante e mantiene il brano corrente', () => {
    const q = setShuffle(createQueue(ten, 3), true, seeded());
    expect(currentId(q)).toBe('t4');
    expect(q.order.slice(0, 4)).toEqual([0, 1, 2, 3]);
    expect([...upcoming(q)].sort()).toEqual(['t10', 't5', 't6', 't7', 't8', 't9'].sort());
    expect(upcoming(q)).not.toEqual(['t5', 't6', 't7', 't8', 't9', 't10']);
  });

  test('disattivandolo torna l’ordine originale dal brano corrente', () => {
    let q = setShuffle(createQueue(ten, 0), true, seeded());
    q = next(next(q).queue).queue; // due brani dopo, in ordine casuale
    const cur = currentId(q)!;
    q = setShuffle(q, false);
    expect(currentId(q)).toBe(cur);
    const idx = ten.indexOf(cur);
    expect(upcoming(q)).toEqual(ten.slice(idx + 1));
  });
});

test('jumpTo e rimozione di un brano dalla coda', () => {
  let q = jumpTo(createQueue(['a', 'b', 'c', 'b'], 0), 2);
  expect(currentId(q)).toBe('c');
  q = removeTrack(q, 'b');
  expect(q.items).toEqual(['a', 'c']);
  expect(currentId(q)).toBe('c');
  expect(upcoming(q)).toEqual([]);
});
