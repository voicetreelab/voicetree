import type { JSX } from 'react';
import { useUsageData } from '@/shell/UI/views/hooks/useUsageData';
import type { ClaudeUsageWindow, CodexRateLimit } from '@/shell/edge/main/observability/usage/types';

const STALE_THRESHOLD_MS: number = 15 * 60_000;

function formatTokens(n: number): string {
  if (n < 1_000) return n.toString();
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function formatResetTime(unixSeconds: number): string {
  if (unixSeconds <= 0) return '';
  const ms: number = unixSeconds * 1000 - Date.now();
  if (ms <= 0) return 'now';
  const minutes: number = Math.floor(ms / 60_000);
  const hours: number = Math.floor(minutes / 60);
  const days: number = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

function formatAgo(iso: string | undefined): string {
  if (!iso) return '';
  const ms: number = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return '';
  const minutes: number = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours: number = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days: number = Math.floor(hours / 24);
  return `${days}d ago`;
}

function isStale(iso: string | undefined): boolean {
  if (!iso) return false;
  const ms: number = Date.now() - Date.parse(iso);
  return Number.isFinite(ms) && ms > STALE_THRESHOLD_MS;
}

function percentColor(percent: number): string {
  if (percent >= 80) return 'bg-red-500';
  if (percent >= 50) return 'bg-yellow-500';
  return 'bg-green-500';
}

interface PercentRowProps {
  readonly label: string;
  readonly percent: number | null;
  readonly resetText: string;
  readonly fallbackTokens?: ClaudeUsageWindow;
  readonly testId?: string;
  readonly isLoading: boolean;
}

function PercentRow({ label, percent, resetText, fallbackTokens, testId, isLoading }: PercentRowProps): JSX.Element {
  if (percent === null) {
    return (
      <div className="flex flex-col gap-0.5 py-0.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-gray-600 text-[10px]">{label}</span>
          {isLoading ? (
            <span className="flex items-center gap-1 text-gray-400 text-[10px]">
              <Spinner /> fetching…
            </span>
          ) : fallbackTokens ? (
            <span className="text-gray-500 font-mono text-[10px]">
              {formatTokens(fallbackTokens.totalTokens)} tok · {fallbackTokens.messageCount} msg
            </span>
          ) : (
            <span className="text-gray-400 text-[10px]">—</span>
          )}
        </div>
      </div>
    );
  }

  const safePercent: number = Math.max(0, Math.min(100, percent));
  return (
    <div className="flex flex-col gap-0.5 py-0.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-gray-600 text-[10px]">{label}</span>
        <span data-testid={testId} className="text-gray-900 font-mono text-[11px]">
          {percent}%{resetText ? ` · resets ${resetText}` : ''}
        </span>
      </div>
      <div className="h-1.5 bg-gray-200 rounded overflow-hidden">
        <div className={`h-full ${percentColor(safePercent)}`} style={{ width: `${safePercent}%` }} />
      </div>
    </div>
  );
}

function CodexRow({ label, rl }: { readonly label: string; readonly rl: CodexRateLimit | undefined }): JSX.Element {
  if (!rl) {
    return (
      <div className="flex items-center justify-between gap-2 py-0.5">
        <span className="text-gray-600 text-[10px]">{label}</span>
        <span className="text-gray-400 text-[10px]">—</span>
      </div>
    );
  }
  const safePercent: number = Math.max(0, Math.min(100, rl.usedPercent));
  return (
    <div className="flex flex-col gap-0.5 py-0.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-gray-600 text-[10px]">{label}</span>
        <span data-testid="codex-percent" className="text-gray-900 font-mono text-[11px]">
          {rl.usedPercent}%{rl.resetAtUnix > 0 ? ` · resets in ${formatResetTime(rl.resetAtUnix)}` : ''}
        </span>
      </div>
      <div className="h-1.5 bg-gray-200 rounded overflow-hidden">
        <div className={`h-full ${percentColor(safePercent)}`} style={{ width: `${safePercent}%` }} />
      </div>
    </div>
  );
}

function Spinner(): JSX.Element {
  return (
    <span
      data-testid="usage-spinner"
      className="inline-block w-2.5 h-2.5 border border-gray-400 border-t-transparent rounded-full animate-spin"
    />
  );
}

export function UsageSection(): JSX.Element {
  const { data, isLoading, isClaudeRefreshing, error, refreshClaude } = useUsageData();

  if (error) {
    return (
      <div data-testid="usage-section" className="p-2 text-[10px] text-red-600 bg-red-50 rounded border border-red-200">
        Error loading usage: {error}
      </div>
    );
  }

  if (!data && isLoading) {
    return (
      <div data-testid="usage-section" className="p-2 text-[10px] text-gray-500 bg-gray-50 rounded border border-gray-200">
        Loading usage...
      </div>
    );
  }

  if (!data) {
    return (
      <div data-testid="usage-section" className="p-2 text-[10px] text-gray-500 bg-gray-50 rounded border border-gray-200">
        Usage data unavailable
      </div>
    );
  }

  const codexCapturedAgo: string = formatAgo(data.codex.capturedAt);
  const codexStale: boolean = isStale(data.codex.capturedAt);

  return (
    <div data-testid="usage-section" className="flex flex-col gap-2 p-2 bg-gray-50 rounded border border-gray-200">
      <div className="text-gray-500 text-[10px] uppercase tracking-wide">Usage</div>

      <div data-testid="claude-usage" className="flex flex-col">
        <div className="flex items-center justify-between mb-0.5">
          <div className="text-gray-700 text-[10px] font-semibold uppercase tracking-wide flex items-center gap-1.5">
            <span>
              Claude Code
              {data.claude.available && data.claude.planType ? ` (${data.claude.planType})` : ''}
              {!data.claude.available ? ' (unavailable)' : ''}
            </span>
            {isClaudeRefreshing && <Spinner />}
          </div>
          <div className="flex items-center gap-1">
            <RefreshButton
              testId="refresh-claude-usage"
              onClick={() => { void refreshClaude(); }}
              disabled={isClaudeRefreshing}
            />
            <OpenSlashCommandButton
              label="Show /usage"
              testId="open-claude-usage"
              onClick={() => window.hostAPI?.main.openClaudeUsage()}
            />
          </div>
        </div>
        {data.claude.available && (
          <>
            <PercentRow
              label="Current session (5h)"
              percent={data.claude.currentSession.usedPercent}
              resetText={data.claude.currentSession.resetsAt ?? ''}
              fallbackTokens={data.claude.currentSession}
              testId="claude-session-percent"
              isLoading={isClaudeRefreshing}
            />
            <PercentRow
              label="Current week (all models)"
              percent={data.claude.currentWeek.usedPercent}
              resetText={data.claude.currentWeek.resetsAt ?? ''}
              fallbackTokens={data.claude.currentWeek}
              testId="claude-week-percent"
              isLoading={isClaudeRefreshing}
            />
            <PercentRow
              label="Current week (sonnet only)"
              percent={data.claude.currentWeekSonnet.usedPercent}
              resetText={data.claude.currentWeekSonnet.resetsAt ?? ''}
              fallbackTokens={data.claude.currentWeekSonnet}
              testId="claude-sonnet-percent"
              isLoading={isClaudeRefreshing}
            />
          </>
        )}
      </div>

      <div data-testid="codex-usage" className="flex flex-col">
        <div className="flex items-center justify-between mb-0.5">
          <div className="text-gray-700 text-[10px] font-semibold uppercase tracking-wide">
            Codex
            {data.codex.available && data.codex.planType ? ` (${data.codex.planType.toUpperCase()})` : ''}
            {!data.codex.available ? ' (unavailable)' : ''}
          </div>
          <OpenSlashCommandButton
            label="Show /status"
            testId="open-codex-status"
            onClick={() => window.hostAPI?.main.openCodexStatus()}
          />
        </div>
        {data.codex.available && (
          <>
            <CodexRow label="5h limit" rl={data.codex.primary} />
            <CodexRow label="Weekly limit" rl={data.codex.secondary} />
            {codexCapturedAgo && (
              <div
                data-testid="codex-captured-at"
                className={`text-[9px] mt-0.5 ${codexStale ? 'text-amber-600' : 'text-gray-400'}`}
                title="Codex emits rate-limit numbers only on successful API responses, so the value can stay frozen at the pre-limit number after the limit is hit."
              >
                {codexStale ? '⚠ may be stale · ' : ''}captured {codexCapturedAgo}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

interface OpenSlashCommandButtonProps {
  readonly label: string;
  readonly testId: string;
  readonly onClick: () => void | Promise<void>;
}

function OpenSlashCommandButton({ label, testId, onClick }: OpenSlashCommandButtonProps): JSX.Element {
  return (
    <button
      data-testid={testId}
      onClick={() => { void onClick(); }}
      className="px-1.5 py-0.5 text-[9px] rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors"
      title="Open Terminal.app, launch the CLI, and auto-type the slash command"
    >
      {label}
    </button>
  );
}

interface RefreshButtonProps {
  readonly testId: string;
  readonly onClick: () => void;
  readonly disabled: boolean;
}

function RefreshButton({ testId, onClick, disabled }: RefreshButtonProps): JSX.Element {
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      title="Re-run claude /usage to fetch fresh percentages"
      className="px-1.5 py-0.5 text-[9px] rounded bg-gray-200 text-gray-700 hover:bg-gray-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      Refresh
    </button>
  );
}
