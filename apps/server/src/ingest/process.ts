import { spawn } from 'node:child_process';
import os from 'node:os';

export interface RunOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Priorità del processo (nice): 0 normale, 19 minima. */
  nice?: number;
  onStdoutLine?: (line: string) => void;
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
}

export class SpawnError extends Error {
  constructor(
    message: string,
    public override readonly cause: unknown,
  ) {
    super(message);
    this.name = 'SpawnError';
  }
}

/**
 * Esegue un comando senza shell (gli argomenti non vengono mai interpretati),
 * con timeout, annullamento e lettura riga per riga di stdout.
 */
export function runProcess(command: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let pending = '';
    let timedOut = false;
    let aborted = false;
    let settled = false;

    if (opts.nice && child.pid) {
      try {
        // I processi figli di yt-dlp (ffmpeg) ereditano la priorità.
        os.setPriority(child.pid, opts.nice);
      } catch {}
    }

    const kill = () => {
      if (child.exitCode === null) child.kill('SIGKILL');
    };
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          kill();
        }, opts.timeoutMs)
      : undefined;
    const onAbort = () => {
      aborted = true;
      kill();
    };
    if (opts.signal?.aborted) onAbort();
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      if (!opts.onStdoutLine) return;
      pending += chunk;
      const lines = pending.split(/\r?\n|\r/);
      pending = lines.pop() ?? '';
      for (const line of lines) if (line) opts.onStdoutLine(line);
    });
    child.stderr.on('data', (chunk: string) => {
      // Limite di sicurezza sulla memoria: tiene solo la coda dell'output d'errore.
      stderr = (stderr + chunk).slice(-64 * 1024);
    });

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      fn();
    };
    child.on('error', (err) => finish(() => reject(new SpawnError(`Impossibile avviare ${command}`, err))));
    child.on('close', (code) => {
      if (pending && opts.onStdoutLine) opts.onStdoutLine(pending);
      finish(() => resolve({ code, stdout, stderr, timedOut, aborted }));
    });
  });
}
