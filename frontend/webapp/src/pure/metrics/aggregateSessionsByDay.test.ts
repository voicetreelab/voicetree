import { describe, it, expect } from 'vitest';
import { aggregateSessionsByDay, type DayAggregation } from './aggregateSessionsByDay';
import type { SessionMetric } from '@/shell/UI/views/hooks/useAgentMetrics';

describe('aggregateSessionsByDay', () => {
  it('should return empty array for empty sessions', () => {
    const result: DayAggregation[] = aggregateSessionsByDay([]);
    expect(result).toEqual([]);
  });

  it('should return empty array when no sessions have durationMs', () => {
    const sessions: SessionMetric[] = [
      { sessionId: '1', agentName: 'Claude', contextNode: 'test', startTime: '2025-12-30T10:00:00Z' },
      { sessionId: '2', agentName: 'Claude', contextNode: 'test', startTime: '2025-12-30T11:00:00Z' },
    ];
    const result: DayAggregation[] = aggregateSessionsByDay(sessions);
    expect(result).toEqual([]);
  });

  it('should aggregate single session correctly', () => {
    const sessions: SessionMetric[] = [
      { sessionId: '1', agentName: 'Claude', contextNode: 'test', startTime: '2025-12-30T10:00:00Z', durationMs: 300000 },
    ];
    const result: DayAggregation[] = aggregateSessionsByDay(sessions);
    expect(result).toEqual([
      { date: '2025-12-30', avgDurationMinutes: 5 }
    ]);
  });

  it('should calculate average duration for multiple sessions on same day', () => {
    const sessions: SessionMetric[] = [
      { sessionId: '1', agentName: 'Claude', contextNode: 'test', startTime: '2025-12-30T09:00:00Z', durationMs: 600000 }, // 10 min
      { sessionId: '2', agentName: 'Claude', contextNode: 'test', startTime: '2025-12-30T14:00:00Z', durationMs: 1200000 }, // 20 min
    ];
    const result: DayAggregation[] = aggregateSessionsByDay(sessions);
    expect(result).toEqual([
      { date: '2025-12-30', avgDurationMinutes: 15 } // (10 + 20) / 2 = 15
    ]);
  });

  it('should group sessions by day and sort by date ascending', () => {
    const sessions: SessionMetric[] = [
      { sessionId: '1', agentName: 'Claude', contextNode: 'test', startTime: '2025-12-30T10:00:00Z', durationMs: 300000 }, // 5 min
      { sessionId: '2', agentName: 'Claude', contextNode: 'test', startTime: '2025-12-28T10:00:00Z', durationMs: 600000 }, // 10 min
      { sessionId: '3', agentName: 'Claude', contextNode: 'test', startTime: '2025-12-29T10:00:00Z', durationMs: 900000 }, // 15 min
    ];
    const result: DayAggregation[] = aggregateSessionsByDay(sessions);
    expect(result).toEqual([
      { date: '2025-12-28', avgDurationMinutes: 10 },
      { date: '2025-12-29', avgDurationMinutes: 15 },
      { date: '2025-12-30', avgDurationMinutes: 5 },
    ]);
  });

  it('should skip sessions without durationMs in averages', () => {
    const sessions: SessionMetric[] = [
      { sessionId: '1', agentName: 'Claude', contextNode: 'test', startTime: '2025-12-30T09:00:00Z', durationMs: 600000 }, // 10 min
      { sessionId: '2', agentName: 'Claude', contextNode: 'test', startTime: '2025-12-30T14:00:00Z' }, // running, no duration
      { sessionId: '3', agentName: 'Claude', contextNode: 'test', startTime: '2025-12-30T16:00:00Z', durationMs: 1200000 }, // 20 min
    ];
    const result: DayAggregation[] = aggregateSessionsByDay(sessions);
    expect(result).toEqual([
      { date: '2025-12-30', avgDurationMinutes: 15 } // (10 + 20) / 2 = 15
    ]);
  });

  it('should handle zero duration sessions', () => {
    const sessions: SessionMetric[] = [
      { sessionId: '1', agentName: 'Claude', contextNode: 'test', startTime: '2025-12-30T10:00:00Z', durationMs: 0 },
    ];
    const result: DayAggregation[] = aggregateSessionsByDay(sessions);
    expect(result).toEqual([
      { date: '2025-12-30', avgDurationMinutes: 0 }
    ]);
  });

  it('should round avgDurationMinutes to 1 decimal place', () => {
    const sessions: SessionMetric[] = [
      { sessionId: '1', agentName: 'Claude', contextNode: 'test', startTime: '2025-12-30T09:00:00Z', durationMs: 100000 }, // 1.666... min
      { sessionId: '2', agentName: 'Claude', contextNode: 'test', startTime: '2025-12-30T14:00:00Z', durationMs: 200000 }, // 3.333... min
    ];
    const result: DayAggregation[] = aggregateSessionsByDay(sessions);
    // avg = (100000 + 200000) / 2 / 60000 = 2.5 min
    expect(result).toEqual([
      { date: '2025-12-30', avgDurationMinutes: 2.5 }
    ]);
  });
});
