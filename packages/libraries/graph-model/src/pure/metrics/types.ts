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
