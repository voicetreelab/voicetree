export interface ClaudeUsageWindow {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  messageCount: number;
  /** Percent of plan limit used, scraped from `claude /usage`. Null until headless agent returns. */
  usedPercent: number | null;
  /** Human-readable reset time from `/usage` (e.g. "2:10am (Australia/Sydney)"). */
  resetsAt: string | null;
}

export interface ClaudeUsage {
  available: boolean;
  /** True while the headless `claude /usage` scrape is running. */
  isRefreshing: boolean;
  /** Plan label scraped from `/usage` header, e.g. "Claude Max", "Claude Pro". */
  planType: string | null;
  currentSession: ClaudeUsageWindow;
  currentWeek: ClaudeUsageWindow;
  currentWeekSonnet: ClaudeUsageWindow;
}

export interface CodexRateLimit {
  usedPercent: number;
  windowMinutes: number;
  resetAtUnix: number;
}

export interface CodexUsage {
  available: boolean;
  planType?: string;
  primary?: CodexRateLimit;
  secondary?: CodexRateLimit;
  capturedAt?: string;
}

export interface UsageData {
  claude: ClaudeUsage;
  codex: CodexUsage;
}

export function emptyClaudeWindow(): ClaudeUsageWindow {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
    messageCount: 0,
    usedPercent: null,
    resetsAt: null,
  };
}
