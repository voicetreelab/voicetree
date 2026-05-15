import { execFile } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import type { CodexRateLimit, CodexUsage } from './types';

const execFileP: (file: string, args: readonly string[], options?: { timeout?: number; maxBuffer?: number }) => Promise<{ stdout: string; stderr: string }> = promisify(execFile);

const SQLITE_TIMEOUT_MS: number = 5000;
const SQLITE_MAX_BUFFER: number = 1024 * 1024;
const WEBSOCKET_MARKER: string = 'websocket event: ';

interface RawRateLimitNode {
  used_percent?: number;
  window_minutes?: number;
  reset_at?: number;
}

interface RawRateLimitsPayload {
  type?: string;
  plan_type?: string;
  rate_limits?: {
    primary?: RawRateLimitNode;
    secondary?: RawRateLimitNode;
  };
}

function extractRateLimit(node: RawRateLimitNode | undefined): CodexRateLimit | undefined {
  if (!node || typeof node !== 'object') return undefined;
  return {
    usedPercent: typeof node.used_percent === 'number' ? node.used_percent : 0,
    windowMinutes: typeof node.window_minutes === 'number' ? node.window_minutes : 0,
    resetAtUnix: typeof node.reset_at === 'number' ? node.reset_at : 0,
  };
}

function codexUsageFromRow(row: { ts: number; feedback_log_body: string }): CodexUsage {
  const idx: number = row.feedback_log_body.indexOf(WEBSOCKET_MARKER);
  if (idx < 0) return { available: false };

  const jsonPart: string = row.feedback_log_body.slice(idx + WEBSOCKET_MARKER.length).trim();

  let parsed: RawRateLimitsPayload;
  try {
    parsed = JSON.parse(jsonPart);
  } catch {
    return { available: false };
  }

  if (!parsed || parsed.type !== 'codex.rate_limits' || !parsed.rate_limits) {
    return { available: false };
  }

  return {
    available: true,
    planType: typeof parsed.plan_type === 'string' ? parsed.plan_type : undefined,
    primary: extractRateLimit(parsed.rate_limits.primary),
    secondary: extractRateLimit(parsed.rate_limits.secondary),
    capturedAt: new Date(row.ts * 1000).toISOString(),
  };
}

export async function fetchCodexUsage(): Promise<CodexUsage> {
  const dbPath: string = path.join(os.homedir(), '.codex', 'logs_2.sqlite');

  try {
    await fs.access(dbPath);
  } catch {
    return { available: false };
  }

  const sql: string = `SELECT ts, feedback_log_body FROM logs WHERE feedback_log_body LIKE '%"type":"codex.rate_limits"%' ORDER BY ts DESC, ts_nanos DESC LIMIT 1;`;

  let stdout: string;
  try {
    const result: { stdout: string; stderr: string } = await execFileP(
      'sqlite3',
      ['-json', '-readonly', dbPath, sql],
      { timeout: SQLITE_TIMEOUT_MS, maxBuffer: SQLITE_MAX_BUFFER },
    );
    stdout = result.stdout;
  } catch {
    return { available: false };
  }

  if (!stdout.trim()) return { available: false };

  let rows: Array<{ ts: number; feedback_log_body: string }>;
  try {
    rows = JSON.parse(stdout);
  } catch {
    return { available: false };
  }

  if (!Array.isArray(rows) || rows.length === 0) return { available: false };

  const row: { ts: number; feedback_log_body: string } = rows[0];
  return codexUsageFromRow(row);
}
