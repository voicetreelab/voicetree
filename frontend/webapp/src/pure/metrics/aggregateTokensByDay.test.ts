import { describe, it, expect } from 'vitest';
import { aggregateTokensByDay, type DayTokenAggregation } from './aggregateTokensByDay';
import type { SessionMetric } from '@/shell/UI/views/hooks/useAgentMetrics';

describe('aggregateTokensByDay', () => {
  it('should return empty array for empty sessions', () => {
    const result: readonly DayTokenAggregation[] = aggregateTokensByDay([]);
    expect(result).toEqual([]);
  });

  it('should return empty array when no sessions have tokens', () => {
    const sessions: SessionMetric[] = [
      { sessionId: '1', agentName: 'Claude', contextNode: 'test', startTime: '2025-12-30T10:00:00Z' },
      { sessionId: '2', agentName: 'Claude', contextNode: 'test', startTime: '2025-12-30T11:00:00Z' },
    ];
    const result: readonly DayTokenAggregation[] = aggregateTokensByDay(sessions);
    expect(result).toEqual([]);
  });

  it('should aggregate single session correctly', () => {
    const sessions: SessionMetric[] = [
      {
        sessionId: '1',
        agentName: 'Claude',
        contextNode: 'test',
        startTime: '2025-12-30T10:00:00Z',
        tokens: { input: 1000, output: 500 }
      },
    ];
    const result: readonly DayTokenAggregation[] = aggregateTokensByDay(sessions);
    expect(result).toEqual([
      { date: '2025-12-30', totalTokens: 1500, averageTokens: 1500 }
    ]);
  });

  it('should sum tokens for multiple sessions on same day', () => {
    const sessions: SessionMetric[] = [
      {
        sessionId: '1',
        agentName: 'Claude',
        contextNode: 'test',
        startTime: '2025-12-30T09:00:00Z',
        tokens: { input: 1000, output: 500 }
      },
      {
        sessionId: '2',
        agentName: 'Claude',
        contextNode: 'test',
        startTime: '2025-12-30T14:00:00Z',
        tokens: { input: 2000, output: 1000 }
      },
    ];
    const result: readonly DayTokenAggregation[] = aggregateTokensByDay(sessions);
    expect(result).toEqual([
      { date: '2025-12-30', totalTokens: 4500, averageTokens: 2250 } // (1000 + 500) + (2000 + 1000) / 2 sessions
    ]);
  });

  it('should group sessions by day and sort by date ascending', () => {
    const sessions: SessionMetric[] = [
      {
        sessionId: '1',
        agentName: 'Claude',
        contextNode: 'test',
        startTime: '2025-12-30T10:00:00Z',
        tokens: { input: 500, output: 200 }
      },
      {
        sessionId: '2',
        agentName: 'Claude',
        contextNode: 'test',
        startTime: '2025-12-28T10:00:00Z',
        tokens: { input: 1000, output: 300 }
      },
      {
        sessionId: '3',
        agentName: 'Claude',
        contextNode: 'test',
        startTime: '2025-12-29T10:00:00Z',
        tokens: { input: 800, output: 400 }
      },
    ];
    const result: readonly DayTokenAggregation[] = aggregateTokensByDay(sessions);
    expect(result).toEqual([
      { date: '2025-12-28', totalTokens: 1300, averageTokens: 1300 },
      { date: '2025-12-29', totalTokens: 1200, averageTokens: 1200 },
      { date: '2025-12-30', totalTokens: 700, averageTokens: 700 },
    ]);
  });

  it('should skip sessions without tokens', () => {
    const sessions: SessionMetric[] = [
      {
        sessionId: '1',
        agentName: 'Claude',
        contextNode: 'test',
        startTime: '2025-12-30T09:00:00Z',
        tokens: { input: 1000, output: 500 }
      },
      {
        sessionId: '2',
        agentName: 'Claude',
        contextNode: 'test',
        startTime: '2025-12-30T14:00:00Z'
      }, // no tokens
      {
        sessionId: '3',
        agentName: 'Claude',
        contextNode: 'test',
        startTime: '2025-12-30T16:00:00Z',
        tokens: { input: 2000, output: 1000 }
      },
    ];
    const result: readonly DayTokenAggregation[] = aggregateTokensByDay(sessions);
    expect(result).toEqual([
      { date: '2025-12-30', totalTokens: 4500, averageTokens: 2250 } // 2 sessions with tokens
    ]);
  });

  it('should handle zero token sessions', () => {
    const sessions: SessionMetric[] = [
      {
        sessionId: '1',
        agentName: 'Claude',
        contextNode: 'test',
        startTime: '2025-12-30T10:00:00Z',
        tokens: { input: 0, output: 0 }
      },
    ];
    const result: readonly DayTokenAggregation[] = aggregateTokensByDay(sessions);
    expect(result).toEqual([
      { date: '2025-12-30', totalTokens: 0, averageTokens: 0 }
    ]);
  });

  it('should include cacheRead tokens in total', () => {
    const sessions: SessionMetric[] = [
      {
        sessionId: '1',
        agentName: 'Claude',
        contextNode: 'test',
        startTime: '2025-12-30T10:00:00Z',
        tokens: { input: 1000, output: 500, cacheRead: 200 }
      },
    ];
    const result: readonly DayTokenAggregation[] = aggregateTokensByDay(sessions);
    expect(result).toEqual([
      { date: '2025-12-30', totalTokens: 1700, averageTokens: 1700 } // 1000 + 500 + 200
    ]);
  });
});
