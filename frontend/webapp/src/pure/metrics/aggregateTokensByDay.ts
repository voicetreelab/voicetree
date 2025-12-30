import type { SessionMetric } from '@/shell/UI/views/hooks/useAgentMetrics';

export interface DayTokenAggregation {
  readonly date: string; // YYYY-MM-DD format
  readonly totalTokens: number;
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

  // Group by date (YYYY-MM-DD) using reduce
  const byDay: Map<string, number> = sessionsWithTokens.reduce(
    (acc: Map<string, number>, session) => {
      const date: string = session.startTime.slice(0, 10);
      const sessionTotal: number = session.tokens.input + session.tokens.output + (session.tokens.cacheRead ?? 0);
      const existing: number = acc.get(date) ?? 0;
      acc.set(date, existing + sessionTotal);
      return acc;
    },
    new Map<string, number>()
  );

  // Convert to array and sort by date
  const result: readonly DayTokenAggregation[] = Array.from(byDay.entries())
    .map(([date, totalTokens]: [string, number]) => ({ date, totalTokens }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return result;
}
