import type { SessionMetric } from '@/shell/UI/views/hooks/useAgentMetrics';

export interface DayAggregation {
  readonly date: string; // YYYY-MM-DD format
  readonly avgDurationMinutes: number;
}

/**
 * Aggregates sessions by day, calculating average duration per day.
 * Sessions without durationMs are skipped.
 * Results are sorted by date ascending.
 */
export function aggregateSessionsByDay(sessions: readonly SessionMetric[]): readonly DayAggregation[] {
  // Filter to sessions with durationMs
  const sessionsWithDuration: readonly (SessionMetric & { readonly durationMs: number })[] = sessions.filter(
    (s): s is SessionMetric & { readonly durationMs: number } => s.durationMs !== undefined
  );

  if (sessionsWithDuration.length === 0) {
    return [];
  }

  // Group by date (YYYY-MM-DD) using reduce
  const byDay: Map<string, readonly number[]> = sessionsWithDuration.reduce(
    (acc: Map<string, number[]>, session) => {
      const date: string = session.startTime.slice(0, 10);
      const existing: number[] = acc.get(date) ?? [];
      acc.set(date, [...existing, session.durationMs]);
      return acc;
    },
    new Map<string, number[]>()
  );

  // Calculate averages and sort by date using Array.from + map
  const result: readonly DayAggregation[] = Array.from(byDay.entries())
    .map(([date, durations]: [string, readonly number[]]) => {
      const totalMs: number = durations.reduce((sum, d) => sum + d, 0);
      const avgMs: number = totalMs / durations.length;
      const avgMinutes: number = Math.round((avgMs / 60000) * 10) / 10;
      return { date, avgDurationMinutes: avgMinutes };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  return result;
}
