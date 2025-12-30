import type { JSX } from 'react';
import { useState, useMemo } from 'react';
import { cn } from '@/utils/lib/utils';
import { useAgentMetrics, type SessionMetric } from './hooks/useAgentMetrics';
import { SessionDurationChart } from './components/SessionDurationChart';
import { TotalTokensChart } from './components/TotalTokensChart';

type TimeFilter = 'today' | 'week' | 'all';

interface FilteredTotals {
  readonly cost: number;
  readonly tokens: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
  };
}

// Formatting helpers
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds: number = Math.floor(ms / 1000);
  const minutes: number = Math.floor(seconds / 60);
  const hours: number = Math.floor(minutes / 60);

  if (hours > 0) {
    const remainingMinutes: number = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }
  if (minutes > 0) {
    const remainingSeconds: number = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}

function formatCost(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

function formatTokens(count: number): string {
  return count.toLocaleString();
}

function formatTimestamp(isoString: string): string {
  const date: Date = new Date(isoString);
  const now: Date = new Date();
  const diffMs: number = now.getTime() - date.getTime();
  const diffMins: number = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours: number = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays: number = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function isToday(isoString: string): boolean {
  const date: Date = new Date(isoString);
  const now: Date = new Date();
  return date.toDateString() === now.toDateString();
}

function isThisWeek(isoString: string): boolean {
  const date: Date = new Date(isoString);
  const now: Date = new Date();
  const weekAgo: Date = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  return date >= weekAgo;
}

export function AgentStatsPanel(): JSX.Element {
  const { sessions, isLoading, error } = useAgentMetrics();
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());

  // Filter sessions by time
  const filteredSessions: SessionMetric[] = useMemo(() => {
    let filtered: SessionMetric[] = sessions;
    if (timeFilter === 'today') {
      filtered = sessions.filter(s => isToday(s.startTime));
    } else if (timeFilter === 'week') {
      filtered = sessions.filter(s => isThisWeek(s.startTime));
    }
    // Sort by most recent first
    return [...filtered].sort((a, b) =>
      new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
    );
  }, [sessions, timeFilter]);

  // Calculate filtered totals
  const filteredTotals: FilteredTotals = useMemo(() => {
    const cost: number = filteredSessions.reduce((sum, s) => sum + (s.costUsd ?? 0), 0);
    const tokens: { input: number; output: number; cacheRead: number } = filteredSessions.reduce(
      (acc, s) => ({
        input: acc.input + (s.tokens?.input ?? 0),
        output: acc.output + (s.tokens?.output ?? 0),
        cacheRead: acc.cacheRead + (s.tokens?.cacheRead ?? 0),
      }),
      { input: 0, output: 0, cacheRead: 0 }
    );
    return { cost, tokens };
  }, [filteredSessions]);

  const toggleSessionExpanded: (sessionId: string) => void = (sessionId: string): void => {
    setExpandedSessions(prev => {
      const next: Set<string> = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  };

  if (error) {
    return (
      <div className="p-4 text-xs text-destructive bg-destructive/10 rounded">
        Error loading metrics: {error}
      </div>
    );
  }

  return (
    <div data-testid="agent-stats-panel" className="flex flex-col gap-3 p-3 bg-background text-foreground font-mono text-xs">
      {/* Time Filter Buttons */}
      <div className="flex items-center gap-2">
        <span className="text-gray-500">Filter:</span>
        <div className="flex gap-1">
          {(['today', 'week', 'all'] as const).map(filter => (
            <button
              key={filter}
              onClick={() => setTimeFilter(filter)}
              className={cn(
                'px-2 py-1 rounded text-xs transition-colors',
                timeFilter === filter
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              )}
            >
              {filter === 'today' ? 'Today' : filter === 'week' ? 'This Week' : 'All Time'}
            </button>
          ))}
        </div>
      </div>

      {/* Summary Cards Section */}
      <div className="grid grid-cols-3 gap-2">
        {/* Total Sessions */}
        <div className="bg-gray-50 rounded p-2 border border-gray-200">
          <div className="text-gray-500 text-[10px] uppercase tracking-wide mb-1">Sessions</div>
          <div data-testid="sessions-count" className="text-lg font-semibold text-gray-900">
            {isLoading ? '...' : filteredSessions.length}
          </div>
        </div>

        {/* Total Cost */}
        <div className="bg-gray-50 rounded p-2 border border-gray-200">
          <div className="text-gray-500 text-[10px] uppercase tracking-wide mb-1">Total Cost</div>
          <div data-testid="total-cost" className="text-lg font-semibold text-gray-900">
            {isLoading ? '...' : formatCost(filteredTotals.cost)}
          </div>
        </div>

        {/* Total Tokens */}
        <div className="bg-gray-50 rounded p-2 border border-gray-200">
          <div className="text-gray-500 text-[10px] uppercase tracking-wide mb-1">Tokens</div>
          <div className="text-sm font-semibold text-gray-900">
            {isLoading ? '...' : (
              <div className="flex flex-col gap-0.5">
                <div data-testid="tokens-input" className="text-xs">
                  <span className="text-gray-500">In:</span> {formatTokens(filteredTotals.tokens.input)}
                </div>
                <div data-testid="tokens-output" className="text-xs">
                  <span className="text-gray-500">Out:</span> {formatTokens(filteredTotals.tokens.output)}
                </div>
                {filteredTotals.tokens.cacheRead > 0 && (
                  <div className="text-xs">
                    <span className="text-gray-500">Cache:</span> {formatTokens(filteredTotals.tokens.cacheRead)}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Session Duration Chart */}
      <div className="flex flex-col gap-1">
        <div className="text-gray-500 text-[10px] uppercase tracking-wide mb-1">
          Avg Session Duration by Day
        </div>
        <SessionDurationChart sessions={filteredSessions} />
      </div>

      {/* Total Tokens Chart */}
      <div className="flex flex-col gap-1">
        <div className="text-gray-500 text-[10px] uppercase tracking-wide mb-1">
          Total Tokens by Day
        </div>
        <TotalTokensChart sessions={filteredSessions} />
      </div>

      {/* Session List Section */}
      <div className="flex flex-col gap-1">
        <div className="text-gray-500 text-[10px] uppercase tracking-wide mb-1">
          Recent Sessions
        </div>

        {isLoading ? (
          <div className="text-gray-500 p-4 text-center">Loading sessions...</div>
        ) : filteredSessions.length === 0 ? (
          <div className="text-gray-500 p-4 text-center">No sessions found</div>
        ) : (
          <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
            {filteredSessions.map(session => {
              const isExpanded: boolean = expandedSessions.has(session.sessionId);
              const isRunning: boolean = !session.endTime;

              return (
                <div
                  key={session.sessionId}
                  data-testid="session-row"
                  className="bg-gray-50 rounded border border-gray-200 overflow-hidden"
                >
                  {/* Compact Row */}
                  <button
                    onClick={() => toggleSessionExpanded(session.sessionId)}
                    className="w-full px-2 py-1.5 hover:bg-gray-100 transition-colors text-left"
                  >
                    <div className="flex items-center justify-between gap-2">
                      {/* Left: Agent name + status */}
                      <div className="flex items-center gap-2 min-w-0">
                        <div
                          className={cn(
                            'w-1.5 h-1.5 rounded-full shrink-0',
                            isRunning ? 'bg-green-500 animate-pulse' : 'bg-gray-400'
                          )}
                        />
                        <span data-testid="session-agent-name" className="font-semibold text-gray-900 truncate">
                          {session.agentName}
                        </span>
                        <span className="text-gray-500 text-[10px]">
                          {formatTimestamp(session.startTime)}
                        </span>
                      </div>

                      {/* Right: Metrics */}
                      <div className="flex items-center gap-3 shrink-0">
                        {session.durationMs !== undefined && (
                          <span data-testid="session-duration" className="text-gray-600">
                            {formatDuration(session.durationMs)}
                          </span>
                        )}
                        {session.tokens && (
                          <span className="text-gray-600">
                            {formatTokens(session.tokens.input + session.tokens.output)}tok
                          </span>
                        )}
                        {session.costUsd !== undefined && (
                          <span data-testid="session-cost" className="text-gray-900 font-semibold">
                            {formatCost(session.costUsd)}
                          </span>
                        )}
                        <span className="text-gray-400 text-[10px]">
                          {isExpanded ? '▼' : '▶'}
                        </span>
                      </div>
                    </div>
                  </button>

                  {/* Expanded Details */}
                  {isExpanded && (
                    <div className="px-3 py-2 bg-white border-t border-gray-200 text-[10px] space-y-1">
                      <div>
                        <span className="text-gray-500">Session ID:</span>{' '}
                        <span className="text-gray-900">{session.sessionId}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Context:</span>{' '}
                        <span className="text-gray-900">{session.contextNode}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Started:</span>{' '}
                        <span className="text-gray-900">
                          {new Date(session.startTime).toLocaleString()}
                        </span>
                      </div>
                      {session.endTime && (
                        <div>
                          <span className="text-gray-500">Ended:</span>{' '}
                          <span className="text-gray-900">
                            {new Date(session.endTime).toLocaleString()}
                          </span>
                        </div>
                      )}
                      {session.tokens && (
                        <div>
                          <span className="text-gray-500">Tokens:</span>{' '}
                          <span className="text-gray-900">
                            In: {formatTokens(session.tokens.input)}, Out: {formatTokens(session.tokens.output)}
                            {session.tokens.cacheRead !== undefined && session.tokens.cacheRead > 0 && (
                              <>, Cache: {formatTokens(session.tokens.cacheRead)}</>
                            )}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
