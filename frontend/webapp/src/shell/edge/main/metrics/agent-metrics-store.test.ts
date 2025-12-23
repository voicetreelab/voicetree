import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import * as os from 'os';
import { startSession, endSession, getMetrics, appendTokenMetrics } from './agent-metrics-store';
import type { AgentMetricsData } from './agent-metrics-store';

vi.mock('../state/app-electron-state', () => ({
  getAppSupportPath: vi.fn(() => testAppSupportPath)
}));

let testAppSupportPath: string;

describe('agent-metrics-store', () => {
  beforeEach(async () => {
    testAppSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-metrics-test-'));
  });

  afterEach(async () => {
    await fs.rm(testAppSupportPath, { recursive: true, force: true });
  });

  it('should create empty metrics file on first read', async () => {
    const metrics: AgentMetricsData = await getMetrics();

    expect(metrics).toEqual({ sessions: [] });

    const metricsPath: string = path.join(testAppSupportPath, 'agent_metrics.json');
    const fileExists: boolean = await fs.access(metricsPath).then(() => true).catch(() => false);
    expect(fileExists).toBe(false); // File is only created on write
  });

  it('should start a new session', async () => {
    const sessionData = {
      sessionId: 'terminal-1234',
      agentName: 'Hana',
      contextNode: 'friday/task.md',
      startTime: '2025-12-21T10:00:00Z'
    };

    await startSession(sessionData);

    const metrics: AgentMetricsData = await getMetrics();
    expect(metrics.sessions).toHaveLength(1);
    expect(metrics.sessions[0]).toEqual({
      sessionId: 'terminal-1234',
      agentName: 'Hana',
      contextNode: 'friday/task.md',
      startTime: '2025-12-21T10:00:00Z'
    });
  });

  it('should end a session and calculate duration', async () => {
    const sessionData = {
      sessionId: 'terminal-5678',
      agentName: 'Claude',
      contextNode: 'monday/review.md',
      startTime: '2025-12-21T10:00:00Z'
    };

    await startSession(sessionData);

    const endData = {
      sessionId: 'terminal-5678',
      exitCode: 0,
      endTime: '2025-12-21T10:15:00Z'
    };

    await endSession(endData);

    const metrics: AgentMetricsData = await getMetrics();
    expect(metrics.sessions).toHaveLength(1);
    expect(metrics.sessions[0].endTime).toBe('2025-12-21T10:15:00Z');
    expect(metrics.sessions[0].durationMs).toBe(900000); // 15 minutes in ms
  });

  it('should handle multiple sessions', async () => {
    await startSession({
      sessionId: 'terminal-1',
      agentName: 'Hana',
      contextNode: 'project/feature-a.md',
      startTime: '2025-12-21T09:00:00Z'
    });

    await startSession({
      sessionId: 'terminal-2',
      agentName: 'Claude',
      contextNode: 'project/feature-b.md',
      startTime: '2025-12-21T09:30:00Z'
    });

    const metrics: AgentMetricsData = await getMetrics();
    expect(metrics.sessions).toHaveLength(2);
    expect(metrics.sessions[0].sessionId).toBe('terminal-1');
    expect(metrics.sessions[1].sessionId).toBe('terminal-2');
  });

  it('should persist data across reads', async () => {
    await startSession({
      sessionId: 'terminal-persist',
      agentName: 'TestAgent',
      contextNode: 'test/persist.md',
      startTime: '2025-12-21T11:00:00Z'
    });

    const firstRead: AgentMetricsData = await getMetrics();
    expect(firstRead.sessions).toHaveLength(1);

    const secondRead: AgentMetricsData = await getMetrics();
    expect(secondRead.sessions).toHaveLength(1);
    expect(secondRead.sessions[0].sessionId).toBe('terminal-persist');
  });

  it('should use atomic writes', async () => {
    await startSession({
      sessionId: 'terminal-atomic',
      agentName: 'AtomicAgent',
      contextNode: 'test/atomic.md',
      startTime: '2025-12-21T12:00:00Z'
    });

    const metricsPath: string = path.join(testAppSupportPath, 'agent_metrics.json');
    const tempPath: string = `${metricsPath}.tmp`;

    // Temp file should not exist after write completes
    const tempExists: boolean = await fs.access(tempPath).then(() => true).catch(() => false);
    expect(tempExists).toBe(false);

    // Main file should exist
    const mainExists: boolean = await fs.access(metricsPath).then(() => true).catch(() => false);
    expect(mainExists).toBe(true);
  });

  it('should handle ending non-existent session gracefully', async () => {
    await startSession({
      sessionId: 'terminal-exists',
      agentName: 'ExistingAgent',
      contextNode: 'test/exists.md',
      startTime: '2025-12-21T13:00:00Z'
    });

    await endSession({
      sessionId: 'terminal-nonexistent',
      exitCode: 0,
      endTime: '2025-12-21T13:15:00Z'
    });

    const metrics: AgentMetricsData = await getMetrics();
    expect(metrics.sessions).toHaveLength(1);
    expect(metrics.sessions[0].sessionId).toBe('terminal-exists');
    expect(metrics.sessions[0].endTime).toBeUndefined();
  });

  it('should create parent directory if needed', async () => {
    await fs.rm(testAppSupportPath, { recursive: true, force: true });

    await startSession({
      sessionId: 'terminal-mkdir',
      agentName: 'MkdirAgent',
      contextNode: 'test/mkdir.md',
      startTime: '2025-12-21T14:00:00Z'
    });

    const metricsPath: string = path.join(testAppSupportPath, 'agent_metrics.json');
    const fileExists: boolean = await fs.access(metricsPath).then(() => true).catch(() => false);
    expect(fileExists).toBe(true);
  });

  it('should correctly format JSON output', async () => {
    await startSession({
      sessionId: 'terminal-json',
      agentName: 'JsonAgent',
      contextNode: 'test/json.md',
      startTime: '2025-12-21T15:00:00Z'
    });

    await endSession({
      sessionId: 'terminal-json',
      exitCode: 0,
      endTime: '2025-12-21T15:10:00Z'
    });

    const metricsPath: string = path.join(testAppSupportPath, 'agent_metrics.json');
    const fileContent: string = await fs.readFile(metricsPath, 'utf-8');
    const parsed: AgentMetricsData = JSON.parse(fileContent) as AgentMetricsData;

    expect(parsed.sessions).toHaveLength(1);
    expect(parsed.sessions[0]).toEqual({
      sessionId: 'terminal-json',
      agentName: 'JsonAgent',
      contextNode: 'test/json.md',
      startTime: '2025-12-21T15:00:00Z',
      endTime: '2025-12-21T15:10:00Z',
      durationMs: 600000
    });
  });

  it('should append token metrics to existing session', async () => {
    await startSession({
      sessionId: 'terminal-tokens',
      agentName: 'TokenAgent',
      contextNode: 'test/tokens.md',
      startTime: '2025-12-21T16:00:00Z'
    });

    await appendTokenMetrics({
      sessionId: 'terminal-tokens',
      tokens: { input: 1500, output: 800, cacheRead: 500 },
      costUsd: 0.0234
    });

    const metrics: AgentMetricsData = await getMetrics();
    expect(metrics.sessions).toHaveLength(1);
    expect(metrics.sessions[0].tokens).toEqual({ input: 1500, output: 800, cacheRead: 500 });
    expect(metrics.sessions[0].costUsd).toBe(0.0234);
  });

  it('should handle appendTokenMetrics for non-existent session gracefully', async () => {
    await startSession({
      sessionId: 'terminal-exists-2',
      agentName: 'ExistingAgent2',
      contextNode: 'test/exists2.md',
      startTime: '2025-12-21T17:00:00Z'
    });

    // This should not throw, just log a warning
    await appendTokenMetrics({
      sessionId: 'terminal-nonexistent-2',
      tokens: { input: 100, output: 50 },
      costUsd: 0.01
    });

    const metrics: AgentMetricsData = await getMetrics();
    expect(metrics.sessions).toHaveLength(1);
    expect(metrics.sessions[0].tokens).toBeUndefined();
    expect(metrics.sessions[0].costUsd).toBeUndefined();
  });

  it('should persist token metrics to JSON file', async () => {
    await startSession({
      sessionId: 'terminal-persist-tokens',
      agentName: 'PersistTokenAgent',
      contextNode: 'test/persist-tokens.md',
      startTime: '2025-12-21T18:00:00Z'
    });

    await appendTokenMetrics({
      sessionId: 'terminal-persist-tokens',
      tokens: { input: 2000, output: 1000, cacheRead: 750 },
      costUsd: 0.0456
    });

    const metricsPath: string = path.join(testAppSupportPath, 'agent_metrics.json');
    const fileContent: string = await fs.readFile(metricsPath, 'utf-8');
    const parsed: AgentMetricsData = JSON.parse(fileContent) as AgentMetricsData;

    expect(parsed.sessions[0].tokens).toEqual({ input: 2000, output: 1000, cacheRead: 750 });
    expect(parsed.sessions[0].costUsd).toBe(0.0456);
  });
});
