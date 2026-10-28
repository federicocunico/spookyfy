import type { AudioSource } from './youtube.js';

/** Blocchi della lettura sequenziale: YouTube rallenta le richieste singole molto grandi. */
export const CHUNK_BYTES = 8 * 1024 * 1024;

export interface ParsedRange {
  start: number;
  end: number;
}

/** Range a byte singolo (`bytes=a-b`, `bytes=a-`, `bytes=-n`); null se assente, 'invalid' se non soddisfacibile. */
export function parseRange(header: string | null, size: number): ParsedRange | null | 'invalid' {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return 'invalid';
  const [, a, b] = m;
  let start: number;
  let end: number;
  if (a === '' && b !== '') {
    const n = Number(b);
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(a);
    end = b === '' ? size - 1 : Math.min(Number(b), size - 1);
  }
  if (!Number.isFinite(start) || start >= size || end < start) return 'invalid';
  return { start, end };
}

const baseHeaders = (src: AudioSource) => ({
  'content-type': src.mimeType,
  'accept-ranges': 'bytes',
  // Audio dell'utente autenticato: mai nelle cache condivise.
  'cache-control': 'private, no-store',
});

/**
 * Inoltra il flusso audio in streaming (niente limite di 4,5 MB sulle risposte in
 * streaming), senza salvarlo. Con Range: un'unica richiesta all'origine; senza:
 * lettura a blocchi da 8 MB concatenati in un unico flusso.
 */
export async function proxyAudio(
  src: AudioSource,
  rangeHeader: string | null,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<Response> {
  const size = src.sizeBytes;
  const range = parseRange(rangeHeader, size);
  if (range === 'invalid') {
    return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
  }

  const fetchRange = async (start: number, end: number) => {
    const res = await fetchImpl(src.url, { headers: { range: `bytes=${start}-${end}` }, signal });
    if (!res.ok || !res.body) throw new Error(`Origine audio: HTTP ${res.status}`);
    return res.body;
  };

  if (range) {
    const body = await fetchRange(range.start, range.end);
    return new Response(body, {
      status: 206,
      headers: {
        ...baseHeaders(src),
        'content-range': `bytes ${range.start}-${range.end}/${size}`,
        'content-length': String(range.end - range.start + 1),
      },
    });
  }

  let offset = 0;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        if (!reader) {
          if (offset >= size) {
            controller.close();
            return;
          }
          const end = Math.min(offset + CHUNK_BYTES, size) - 1;
          reader = (await fetchRange(offset, end)).getReader();
        }
        const { done, value } = await reader.read();
        if (done) {
          reader = null;
          continue;
        }
        offset += value.byteLength;
        controller.enqueue(value);
        return;
      }
    },
    cancel() {
      void reader?.cancel();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { ...baseHeaders(src), 'content-length': String(size) },
  });
}
