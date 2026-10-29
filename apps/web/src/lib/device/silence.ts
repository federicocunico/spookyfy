import { type TrimPoints, edgeSilenceFromPcm, trimPoints } from '@spookyfy/shared';

/** Punti di auto-trim di un file audio; null se il browser non riesce a decodificarlo. */
export type SilenceAnalyzer = (audio: Blob) => Promise<TrimPoints | null>;

/**
 * Decodifica a bassa frequenza di campionamento: per riconoscere il silenzio basta e un
 * brano di 4 minuti occupa ~15 MB invece di ~85. Safari meno recenti non accettano meno
 * di 22,05 kHz: si riprova con quella.
 */
const SAMPLE_RATES = [8000, 22050];

export const analyzeSilence: SilenceAnalyzer = async (audio) => {
  const Ctx =
    globalThis.OfflineAudioContext ??
    (globalThis as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
      .webkitOfflineAudioContext;
  if (!Ctx) return null;
  try {
    const bytes = await audio.arrayBuffer();
    for (const rate of SAMPLE_RATES) {
      let ctx: OfflineAudioContext;
      try {
        ctx = new Ctx(1, 1, rate);
      } catch {
        continue;
      }
      // decodeAudioData consuma il buffer: se ne passa una copia.
      const buf = await ctx.decodeAudioData(bytes.slice(0));
      const channels = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
      return trimPoints(edgeSilenceFromPcm(channels, buf.sampleRate));
    }
    return null;
  } catch {
    return null;
  }
};
