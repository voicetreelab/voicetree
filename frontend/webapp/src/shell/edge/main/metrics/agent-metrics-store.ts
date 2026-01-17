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

/** Validate that a session has the minimum required fields */
function isValidSession(session: unknown): session is SessionMetric {
  if (!session || typeof session !== 'object') return false;
  const s: Record<string, unknown> = session as Record<string, unknown>;
  return (
    typeof s.sessionId === 'string' &&
    typeof s.agentName === 'string' &&
    typeof s.contextNode === 'string' &&
    typeof s.startTime === 'string'
  );
}

/** Extract valid sessions from parsed data, preserving what we can */
function extractValidSessions(parsed: unknown): SessionMetric[] {
  if (!parsed || typeof parsed !== 'object') {
    return [];
  }

  // Try to find sessions array in the parsed data
  let rawSessions: unknown[] = [];

  if ('sessions' in parsed && Array.isArray((parsed as { sessions: unknown }).sessions)) {
    rawSessions = (parsed as { sessions: unknown[] }).sessions;
  } else if (Array.isArray(parsed)) {
    // Handle case where file is just an array
    rawSessions = parsed;
  }

  // Validate each session individually, keeping only valid ones
  const validSessions: SessionMetric[] = [];
  let invalidCount: number = 0;

  for (const session of rawSessions) {
    if (isValidSession(session)) {
      validSessions.push(session);
    } else {
      invalidCount++;
    }
  }

  if (invalidCount > 0) {
    console.warn(`[agent-metrics-store] Discarded ${invalidCount} invalid session(s), kept ${validSessions.length} valid session(s)`);
  }

  return validSessions;
}

async function readMetrics(): Promise<AgentMetricsData> {
  const metricsPath: string = getMetricsPath();
  try {
    const data: string = await fs.readFile(metricsPath, 'utf-8');
    const parsed: unknown = JSON.parse(data);
    const sessions: SessionMetric[] = extractValidSessions(parsed);
    return { sessions };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { sessions: [] };
    }
    if (error instanceof SyntaxError) {
      console.error('[agent-metrics-store] Invalid JSON in metrics file:', error.message);
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
