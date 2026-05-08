import { fetchClaudeUsage } from './fetchClaudeUsage';
import { fetchClaudeUsageHeadless } from './fetchClaudeUsageHeadless';
import { fetchCodexUsage } from './fetchCodexUsage';
import {
  emptyClaudeWindow,
  type ClaudeUsage,
  type ClaudeUsageWindow,
  type CodexUsage,
  type UsageData,
} from './types';
import type { ClaudeUsageParsed, ClaudeUsageWindowParsed } from './parseClaudeUsageText';

const UNAVAILABLE_CLAUDE: ClaudeUsage = {
  available: false,
  isRefreshing: false,
  planType: null,
  currentSession: emptyClaudeWindow(),
  currentWeek: emptyClaudeWindow(),
  currentWeekSonnet: emptyClaudeWindow(),
};

const UNAVAILABLE_CODEX: CodexUsage = { available: false };

/**
 * Cheap call: returns token-derived stats from local JSONL files. The headless
 * `claude /usage` scrape runs separately via `refreshClaudeUsageHeadless` so
 * the panel can render immediately without blocking on a 10–20s PTY spawn.
 */
export async function getUsageData(): Promise<UsageData> {
  const [claudeResult, codexResult] = await Promise.allSettled([
    fetchClaudeUsage(),
    fetchCodexUsage(),
  ]);

  const claude: ClaudeUsage = claudeResult.status === 'fulfilled' ? claudeResult.value : UNAVAILABLE_CLAUDE;
  const codex: CodexUsage = codexResult.status === 'fulfilled' ? codexResult.value : UNAVAILABLE_CODEX;

  return { claude, codex };
}

function applyParsedWindow(
  base: ClaudeUsageWindow,
  parsed: ClaudeUsageWindowParsed | null,
): ClaudeUsageWindow {
  if (!parsed) return base;
  return { ...base, usedPercent: parsed.usedPercent, resetsAt: parsed.resetsAt };
}

/**
 * Slow call: spawns a headless `claude` PTY, sends `/usage`, scrapes the
 * percentages and plan, returns an updated ClaudeUsage. UI shows a spinner
 * while this is in flight.
 */
export async function refreshClaudeUsageHeadless(): Promise<ClaudeUsage> {
  const [tokenResult, headlessResult] = await Promise.allSettled([
    fetchClaudeUsage(),
    fetchClaudeUsageHeadless(),
  ]);

  const tokenBased: ClaudeUsage = tokenResult.status === 'fulfilled' ? tokenResult.value : UNAVAILABLE_CLAUDE;
  const parsed: ClaudeUsageParsed | null = headlessResult.status === 'fulfilled' ? headlessResult.value : null;

  if (!parsed) return tokenBased;

  return {
    ...tokenBased,
    available: true,
    planType: parsed.planType,
    currentSession: applyParsedWindow(tokenBased.currentSession, parsed.currentSession),
    currentWeek: applyParsedWindow(tokenBased.currentWeek, parsed.currentWeek),
    currentWeekSonnet: applyParsedWindow(tokenBased.currentWeekSonnet, parsed.currentWeekSonnet),
  };
}
