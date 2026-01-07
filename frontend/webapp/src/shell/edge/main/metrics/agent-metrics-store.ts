import { promises as fs } from 'fs';
import path from 'path';
import { getAppSupportPath } from '@/shell/edge/main/state/app-electron-state';

export interface TokenMetrics {
  input: number;
  output: number;
  cacheRead?: number;
}

export interface SessionMetric {
  sessionId: string;        // Terminal ID from TerminalManager
  agentName: string;        // Agent name (e.g., "Hana")
  contextNode: string;      // Node path (e.g., "friday/task.md")
  startTime: string;        // ISO timestamp
  endTime?: string;         // ISO timestamp (set on session end)
  durationMs?: number;      // Calculated: endTime - startTime
  tokens?: TokenMetrics;    // Token usage metrics (input, output, cache reads)
  costUsd?: number;         // Cost in USD
}

export interface AgentMetricsData {
  sessions: SessionMetric[];
}

function getMetricsPath(): string {
  return path.join(getAppSupportPath(), 'agent_metrics.json');
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

export async function startSession(data: {
  sessionId: string;
  agentName: string;
  contextNode: string;
  startTime: string;
}): Promise<void> {
  const metrics: AgentMetricsData = await readMetrics();

  const newSession: SessionMetric = {
    sessionId: data.sessionId,
    agentName: data.agentName,
    contextNode: data.contextNode,
    startTime: data.startTime,
  };

  metrics.sessions.push(newSession);
  await writeMetrics(metrics);
}

export async function getMetrics(): Promise<AgentMetricsData> {
  return readMetrics();
}

export async function appendTokenMetrics(data: {
  sessionId: string;
  tokens: TokenMetrics;
  costUsd: number;
}): Promise<void> {
  const metrics: AgentMetricsData = await readMetrics();

  let session: SessionMetric | undefined = metrics.sessions.find(
    (s: SessionMetric) => s.sessionId === data.sessionId
  );

  if (!session) {
    // Auto-create session for OTLP metrics from Claude Code
    // Claude Code uses its own session IDs, not VoiceTree terminal IDs
    session = {
      sessionId: data.sessionId,
      agentName: 'Claude',
      contextNode: 'unknown',
      startTime: new Date().toISOString(),
    };
    metrics.sessions.push(session);
  }

  session.tokens = data.tokens;
  session.costUsd = data.costUsd;

  // Update duration for running sessions (no endTime yet)
  if (!session.endTime) {
    session.durationMs = Date.now() - new Date(session.startTime).getTime();
  }

  await writeMetrics(metrics);
}
