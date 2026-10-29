/**
 * Servizi musicali finti per gli e2e (MusicBrainz, Cover Art Archive, iTunes), collegati a
 * server e gateway tramite LOOKUP_*_URL: nessuna richiesta esce dalla macchina.
 *
 * - Un album cercato per titolo e artista viene sempre trovato con gli stessi valori
 *   (corrispondenza sicura), salvo i titoli che contengono "Sconosciuto".
 * - Un brano cercato per titolo è contenuto nell'album "Disco di prova" (anno 2001, genere "test pop").
 * - Le copertine sono PNG a tinta unita, con il colore ricavato dall'identificativo.
 */
import { createHash } from 'node:crypto';
import http from 'node:http';
import { deflateSync } from 'node:zlib';

const PORT = Number(process.env.PORT ?? 4599);

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
/** PNG 64×64 a tinta unita. */
function png([r, g, b]) {
  const size = 64;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.from(Array.from({ length: size }, () => [r, g, b]).flat()),
  ]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const idOf = (s) => createHash('sha1').update(s).digest('hex').slice(0, 32);
/** Valore di un campo della query Lucene: releasegroup:"…", artist:"…", recording:"…". */
const field = (q, name) => {
  const m = new RegExp(`${name}:"((?:[^"\\\\]|\\\\.)*)"`).exec(q);
  return m ? m[1].replace(/\\(.)/g, '$1') : '';
};
const json = (res, body) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  const q = url.searchParams.get('query') ?? '';
  if (url.pathname === '/health') return json(res, { ok: true });

  if (url.pathname.startsWith('/mb/ws/2/release-group')) {
    const title = field(q, 'releasegroup');
    const artist = field(q, 'artist') || 'Artista di prova';
    if (!title || title.includes('Sconosciuto')) return json(res, { 'release-groups': [] });
    return json(res, {
      'release-groups': [
        {
          id: idOf(`${title}|${artist}`),
          score: 100,
          title,
          'first-release-date': '1999-05-01',
          'artist-credit': [{ name: artist }],
          tags: [{ count: 3, name: 'test rock' }],
        },
      ],
    });
  }

  if (url.pathname.startsWith('/mb/ws/2/recording')) {
    const artist = field(q, 'artist') || 'Artista di prova';
    return json(res, {
      recordings: [
        {
          score: 100,
          'artist-credit': [{ name: artist }],
          tags: [{ count: 2, name: 'test pop' }],
          releases: [
            {
              date: '2001-03-03',
              'release-group': {
                id: idOf(`disco|${artist}`),
                title: 'Disco di prova',
                'primary-type': 'Album',
              },
            },
          ],
        },
      ],
    });
  }

  if (url.pathname.startsWith('/itunes/search')) return json(res, { resultCount: 0, results: [] });

  const cover = /^\/caa\/release-group\/([0-9a-f]+)\/front-(250|500)$/.exec(url.pathname);
  if (cover) {
    const h = cover[1];
    const color = [
      Number.parseInt(h.slice(0, 2), 16),
      Number.parseInt(h.slice(2, 4), 16),
      Number.parseInt(h.slice(4, 6), 16),
    ];
    res.writeHead(200, { 'content-type': 'image/png' });
    return res.end(png(color));
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, '127.0.0.1', () => console.log(`Servizi musicali finti su http://127.0.0.1:${PORT}`));
