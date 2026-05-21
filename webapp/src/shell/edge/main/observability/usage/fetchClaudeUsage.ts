import { promises as fs, createReadStream } from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import { emptyClaudeWindow, type ClaudeUsage, type ClaudeUsageWindow } from './types';

const FIVE_HOURS_MS: number = 5 * 60 * 60 * 1000;
const SEVEN_DAYS_MS: number = 7 * 24 * 60 * 60 * 1000;
const SONNET_PATTERN: RegExp = /sonnet/i;

interface RawUsageBlock {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

function addToWindow(w: ClaudeUsageWindow, usage: RawUsageBlock): void {
  const inp: number = usage.input_tokens ?? 0;
  const out: number = usage.output_tokens ?? 0;
  const cacheRead: number = usage.cache_read_input_tokens ?? 0;
  const cacheCreate: number = usage.cache_creation_input_tokens ?? 0;
  w.inputTokens += inp;
  w.outputTokens += out;
  w.cacheReadTokens += cacheRead;
  w.totalTokens += inp + out + cacheRead + cacheCreate;
  w.messageCount += 1;
}

async function processJsonlFile(
  filePath: string,
  sessionCutoff: number,
  weekCutoff: number,
  session: ClaudeUsageWindow,
  week: ClaudeUsageWindow,
  weekSonnet: ClaudeUsageWindow,
): Promise<void> {
  let stream: ReturnType<typeof createReadStream>;
  try {
    stream = createReadStream(filePath, { encoding: 'utf8' });
  } catch {
    return;
  }

  const rl: readline.Interface = readline.createInterface({ input: stream });
  try {
    for await (const line of rl) {
      if (!line || !line.includes('"usage"')) continue;

      let entry: { timestamp?: string; message?: { model?: string; usage?: RawUsageBlock } };
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }

      const ts: number = entry.timestamp ? Date.parse(entry.timestamp) : NaN;
      if (!Number.isFinite(ts) || ts < weekCutoff) continue;

      const message: { model?: string; usage?: RawUsageBlock } | undefined = entry.message;
      if (!message || typeof message !== 'object') continue;

      const usage: RawUsageBlock | undefined = message.usage;
      if (!usage || typeof usage !== 'object') continue;

      addToWindow(week, usage);
      if (ts >= sessionCutoff) addToWindow(session, usage);

      const model: string | undefined = typeof message.model === 'string' ? message.model : undefined;
      if (model !== undefined && SONNET_PATTERN.test(model)) addToWindow(weekSonnet, usage);
    }
  } finally {
    rl.close();
    stream.destroy();
  }
}

export async function fetchClaudeUsage(): Promise<ClaudeUsage> {
  const projectsDir: string = path.join(os.homedir(), '.claude', 'projects');

  let projectEntries: string[];
  try {
    projectEntries = await fs.readdir(projectsDir);
  } catch {
    return {
      available: false,
      isRefreshing: false,
      planType: null,
      currentSession: emptyClaudeWindow(),
      currentWeek: emptyClaudeWindow(),
      currentWeekSonnet: emptyClaudeWindow(),
    };
  }

  const now: number = Date.now();
  const sessionCutoff: number = now - FIVE_HOURS_MS;
  const weekCutoff: number = now - SEVEN_DAYS_MS;

  const session: ClaudeUsageWindow = emptyClaudeWindow();
  const week: ClaudeUsageWindow = emptyClaudeWindow();
  const weekSonnet: ClaudeUsageWindow = emptyClaudeWindow();

  for (const entry of projectEntries) {
    const projDir: string = path.join(projectsDir, entry);
    let projFiles: string[];
    try {
      const stat: Awaited<ReturnType<typeof fs.stat>> = await fs.stat(projDir);
      if (!stat.isDirectory()) continue;
      projFiles = await fs.readdir(projDir);
    } catch {
      continue;
    }

    for (const file of projFiles) {
      if (!file.endsWith('.jsonl')) continue;
      const filePath: string = path.join(projDir, file);

      try {
        const stat: Awaited<ReturnType<typeof fs.stat>> = await fs.stat(filePath);
        if (stat.mtimeMs < weekCutoff) continue;
      } catch {
        continue;
      }

      await processJsonlFile(filePath, sessionCutoff, weekCutoff, session, week, weekSonnet);
    }
  }

  return {
    available: true,
    isRefreshing: false,
    planType: null,
    currentSession: session,
    currentWeek: week,
    currentWeekSonnet: weekSonnet,
  };
}
