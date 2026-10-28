/** 3:07, 1:02:03 */
export function formatTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00';
  const s = Math.floor(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export const formatDurationMs = (ms: number) => formatTime(ms / 1000);

/** "1 h 12 min", "42 min" */
export function formatLongDuration(ms: number): string {
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1).replace('.', ',')} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}

export const pluralize = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 5) return 'Buonanotte';
  if (h < 13) return 'Buongiorno';
  if (h < 18) return 'Buon pomeriggio';
  return 'Buonasera';
}
