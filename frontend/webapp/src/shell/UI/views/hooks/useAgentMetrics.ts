import { useState, useEffect, useCallback } from 'react';

export interface TokenMetrics {
  input: number;
  output: number;
  cacheRead?: number;
}

export interface SessionMetric {
  sessionId: string;
  agentName: string;
  contextNode: string;
  startTime: string;
  endTime?: string;
  durationMs?: number;
  tokens?: TokenMetrics;
  costUsd?: number;
}

interface AgentMetricsData {
  sessions: SessionMetric[];
}

interface UseAgentMetricsReturn {
  sessions: SessionMetric[];
  totalCost: number;
  totalTokens: { input: number; output: number; cacheRead: number };
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const REFRESH_INTERVAL_MS: number = 5000; // 5 seconds

export function useAgentMetrics(): UseAgentMetricsReturn {
  const [sessions, setSessions] = useState<SessionMetric[]>([]);
  const [totalCost, setTotalCost] = useState<number>(0);
  const [totalTokens, setTotalTokens] = useState<{ input: number; output: number; cacheRead: number }>({
    input: 0,
    output: 0,
    cacheRead: 0,
  });
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Check if we're running in Electron
  const isElectron: boolean = window.electronAPI !== undefined;

  // Aggregate metrics from sessions
  const aggregateMetrics: (sessions: SessionMetric[]) => void = useCallback((sessions: SessionMetric[]) => {
    let cost: number = 0;
    let inputTokens: number = 0;
    let outputTokens: number = 0;
    let cacheReadTokens: number = 0;

    for (const session of sessions) {
      if (session.costUsd !== undefined) {
        cost += session.costUsd;
      }
      if (session.tokens !== undefined) {
        inputTokens += session.tokens.input;
        outputTokens += session.tokens.output;
        cacheReadTokens += session.tokens.cacheRead ?? 0;
      }
    }

    setTotalCost(cost);
    setTotalTokens({
      input: inputTokens,
      output: outputTokens,
      cacheRead: cacheReadTokens,
    });
  }, []);

  // Fetch metrics from IPC
  const fetchMetrics: () => Promise<void> = useCallback(async () => {
    if (!isElectron) {
      console.warn('[useAgentMetrics] Not in Electron, cannot fetch metrics');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const data: AgentMetricsData = await window.electronAPI!.main.getMetrics();
      const sessions: SessionMetric[] = Array.isArray(data?.sessions) ? data.sessions : [];
      setSessions(sessions);
      aggregateMetrics(sessions);
      setIsLoading(false);
    } catch (err) {
      console.error('[useAgentMetrics] Failed to fetch metrics:', err);
      setError('Failed to fetch agent metrics');
      setIsLoading(false);
    }
  }, [isElectron, aggregateMetrics]);

  // Fetch metrics on mount
  useEffect(() => {
    if (!isElectron) return;

    void fetchMetrics();
  }, [isElectron, fetchMetrics]);

  // Auto-refresh metrics periodically
  useEffect(() => {
    if (!isElectron) return;

    const intervalId: NodeJS.Timeout = setInterval(() => {
      void fetchMetrics();
    }, REFRESH_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, [isElectron, fetchMetrics]);

  return {
    sessions,
    totalCost,
    totalTokens,
    isLoading,
    error,
    refresh: fetchMetrics,
  };
}

export default useAgentMetrics;
