import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// Token metrics structure (subset of ParsedMetrics.tokens)
export interface TokenMetrics {
  input: number;
  output: number;
  cacheRead?: number;
}

// Session metric structure (matches agent-metrics-store.ts)
interface SessionMetric {
  sessionId: string;
  agentName: string;
  contextNode: string;
  startTime: string;
  endTime?: string;
  durationMs?: number;
  tokens?: TokenMetrics;
  costUsd?: number;
}

// Agent metrics data structure
interface AgentMetricsData {
  sessions: SessionMetric[];
}

function getMetricsPath(): string {
  const appSupport = path.join(os.homedir(), 'Library', 'Application Support', 'VoiceTree');
  return path.join(appSupport, 'agent_metrics.json');
}

async function readMetrics(): Promise<AgentMetricsData> {
  const metricsPath: string = getMetricsPath();
  try {
    const data: string = await fs.readFile(metricsPath, 'utf-8');
    return JSON.parse(data) as AgentMetricsData;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { sessions: [] };
    }
    throw error;
  }
}

async function writeMetrics(data: AgentMetricsData): Promise<void> {
  const metricsPath: string = getMetricsPath();
  const metricsDir: string = path.dirname(metricsPath);
  const tempPath: string = `${metricsPath}.tmp`;

  // Ensure directory exists
  await fs.mkdir(metricsDir, { recursive: true });

  // Atomic write: write to temp file, then rename
  await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf-8');
  await fs.rename(tempPath, metricsPath);
}

export async function appendTokenMetrics(data: {
  sessionId: string;
  tokens: { input: number; output: number; cacheRead?: number };
  costUsd: number;
}): Promise<void> {
  const metrics: AgentMetricsData = await readMetrics();

  const session: SessionMetric | undefined = metrics.sessions.find(
    (s: SessionMetric) => s.sessionId === data.sessionId
  );

  if (session) {
    // Update existing session with token metrics
    session.tokens = data.tokens;
    session.costUsd = data.costUsd;
    await writeMetrics(metrics);
  } else {
    // Session not found - this can happen if metrics arrive before session start
    // or if there's a mismatch in session IDs
    console.warn(`Session ${data.sessionId} not found in metrics file`);
  }
}
