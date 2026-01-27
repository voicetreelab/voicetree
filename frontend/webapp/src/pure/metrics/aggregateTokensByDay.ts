import type { SessionMetric } from '@/shell/UI/views/hooks/useAgentMetrics';

export interface DayTokenAggregation {
  readonly date: string; // YYYY-MM-DD format
  readonly totalTokens: number;
  readonly averageTokens: number; // Average tokens per session
}

/**
 * Aggregates sessions by day, calculating total tokens per day.
 * Sessions without tokens are skipped.
 * Results are sorted by date ascending.
 */
export function aggregateTokensByDay(sessions: readonly SessionMetric[]): readonly DayTokenAggregation[] {
  // Filter to sessions with tokens
  const sessionsWithTokens: readonly (SessionMetric & { readonly tokens: NonNullable<SessionMetric['tokens']> })[] = sessions.filter(
    (s): s is SessionMetric & { readonly tokens: NonNullable<SessionMetric['tokens']> } => s.tokens !== undefined
  );

  if (sessionsWithTokens.length === 0) {
    return [];
  }

  // Group by date (YYYY-MM-DD), tracking total tokens and session count
  interface DayAccumulator {
    readonly totalTokens: number;
    readonly sessionCount: number;
  }
  const byDay: ReadonlyMap<string, DayAccumulator> = sessionsWithTokens.reduce(
    (acc: ReadonlyMap<string, DayAccumulator>, session) => {
      const date: string = session.startTime.slice(0, 10);
      const sessionTotal: number = session.tokens.input + session.tokens.output + (session.tokens.cacheRead ?? 0);
      const existing: DayAccumulator = acc.get(date) ?? { totalTokens: 0, sessionCount: 0 };
      acc.set(date, {
        totalTokens: existing.totalTokens + sessionTotal,
        sessionCount: existing.sessionCount + 1,
      });
      return acc;
    },
    new Map<string, DayAccumulator>()
  );

  // Convert to array and sort by date
  const result: readonly DayTokenAggregation[] = Array.from(byDay.entries())
    .map(([date, { totalTokens, sessionCount }]: readonly [string, DayAccumulator]) => ({
      date,
      totalTokens,
      averageTokens: sessionCount > 0 ? Math.round(totalTokens / sessionCount) : 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return result;
}
