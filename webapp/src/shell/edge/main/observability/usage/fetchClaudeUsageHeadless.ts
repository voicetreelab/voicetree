/**
 * Run a headless `claude` PTY in the background, send `/usage`, scrape
 * the rendered table, parse out percentages + plan, then kill the PTY.
 *
 * Why not `claude --print /usage`? Slash commands are a TUI-only concept;
 * `--print` short-circuits and just emits "You are currently using your
 * subscription..." with no percentages. We try `--print` first per the
 * orchestration choice, fall through to PTY when no usable data appears.
 *
 * node-pty is a native module with environment-conditional ABI (Electron
 * production rebuild vs Node test runner). Must be lazily imported so
 * jsdom-based test runs don't blow up at module load.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { parseClaudeUsageText, type ClaudeUsageParsed } from './parseClaudeUsageText';

const execFileP: (file: string, args: readonly string[], options?: { timeout?: number; maxBuffer?: number }) => Promise<{ stdout: string; stderr: string }> = promisify(execFile);

const PRINT_TIMEOUT_MS: number = 6_000;
const PTY_OVERALL_TIMEOUT_MS: number = 25_000;
const PTY_DISMISS_DELAY_MS: number = 1_500;
const PTY_SLASH_DELAY_MS: number = 6_000;
const PTY_QUIESCE_MS: number = 1_500;
const PTY_MIN_OUTPUT_DELAY_MS: number = 9_000;

function hasUsablePercent(parsed: ClaudeUsageParsed): boolean {
  return parsed.currentSession !== null || parsed.currentWeek !== null;
}

async function tryPrintFastPath(): Promise<ClaudeUsageParsed | null> {
  try {
    const { stdout } = await execFileP('claude', ['--print', '/usage'], {
      timeout: PRINT_TIMEOUT_MS,
      maxBuffer: 256 * 1024,
    });
    const parsed: ClaudeUsageParsed = parseClaudeUsageText(stdout);
    return hasUsablePercent(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function tryPtyScrape(): Promise<ClaudeUsageParsed | null> {
  let ptyModule: typeof import('node-pty');
  try {
    ptyModule = await import('node-pty');
  } catch {
    return null;
  }

  return new Promise<ClaudeUsageParsed | null>((resolve) => {
    let proc: import('node-pty').IPty;
    try {
      proc = ptyModule.spawn('claude', [], {
        name: 'xterm-256color',
        cols: 120,
        rows: 50,
        cwd: process.env.HOME ?? process.cwd(),
        env: process.env as Record<string, string>,
      });
    } catch {
      resolve(null);
      return;
    }

    let buffer: string = '';
    let lastByteAt: number = Date.now();
    let resolved: boolean = false;
    let usageSent: boolean = false;
    let trustDismissed: boolean = false;
    const startedAt: number = Date.now();

    const finish: (value: ClaudeUsageParsed | null) => void = (value) => {
      if (resolved) return;
      resolved = true;
      clearInterval(quiescenceTimer);
      clearTimeout(overallTimer);
      try { proc.kill(); } catch { /* ignore */ }
      resolve(value);
    };

    proc.onData((d: string) => {
      buffer += d;
      lastByteAt = Date.now();
    });

    proc.onExit(() => {
      // Process exited (e.g. claude not installed). Try to parse whatever we
      // have just in case.
      const parsed: ClaudeUsageParsed = parseClaudeUsageText(buffer);
      finish(hasUsablePercent(parsed) ? parsed : null);
    });

    // claude can show a "trust this folder" prompt the first time it sees a
    // cwd. Default option is already "Yes, I trust this folder", so a bare
    // Enter dismisses it. Idempotent if no prompt is showing.
    setTimeout(() => {
      if (resolved || trustDismissed) return;
      trustDismissed = true;
      try { proc.write('\r'); } catch { /* ignore */ }
    }, PTY_DISMISS_DELAY_MS);

    setTimeout(() => {
      if (usageSent || resolved) return;
      usageSent = true;
      try { proc.write('/usage\r'); } catch { /* ignore */ }
    }, PTY_SLASH_DELAY_MS);

    const overallTimer: ReturnType<typeof setTimeout> = setTimeout(() => {
      const parsed: ClaudeUsageParsed = parseClaudeUsageText(buffer);
      finish(hasUsablePercent(parsed) ? parsed : null);
    }, PTY_OVERALL_TIMEOUT_MS);

    // After the slash is sent and output settles, parse and bail early. Saves
    // ~10s when claude renders the panel quickly.
    const quiescenceTimer: ReturnType<typeof setInterval> = setInterval(() => {
      if (!usageSent) return;
      const sinceStart: number = Date.now() - startedAt;
      if (sinceStart < PTY_MIN_OUTPUT_DELAY_MS) return;
      const sinceWrite: number = Date.now() - lastByteAt;
      if (sinceWrite < PTY_QUIESCE_MS) return;
      const parsed: ClaudeUsageParsed = parseClaudeUsageText(buffer);
      if (hasUsablePercent(parsed)) finish(parsed);
    }, 500);
  });
}

export async function fetchClaudeUsageHeadless(): Promise<ClaudeUsageParsed | null> {
  const fastPath: ClaudeUsageParsed | null = await tryPrintFastPath();
  if (fastPath) return fastPath;
  return tryPtyScrape();
}
