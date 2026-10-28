import os from 'node:os';

export interface HardwareProfile {
  cores: number;
  totalMemBytes: number;
  arch: string;
  platform: string;
}

export const MAX_DEFAULT_INGEST_CONCURRENCY = 8;

export function detectHardware(): HardwareProfile {
  return {
    cores: os.availableParallelism(),
    totalMemBytes: os.totalmem(),
    arch: os.arch(),
    platform: os.platform(),
  };
}

/** Metà dei core, almeno 1 e al massimo 8: 2 su un Raspberry Pi a 4 core, 8 su un server grande. */
export function defaultIngestConcurrency(cores: number): number {
  return Math.min(MAX_DEFAULT_INGEST_CONCURRENCY, Math.max(1, Math.floor(cores / 2)));
}

export function resolveIngestConcurrency(
  explicit: number | undefined,
  hw: Pick<HardwareProfile, 'cores'>,
): number {
  return explicit ?? defaultIngestConcurrency(hw.cores);
}
