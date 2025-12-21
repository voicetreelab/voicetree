import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { appendTokenMetrics } from './metrics-writer';

describe('metrics-writer', () => {
  const testDir = path.join(os.tmpdir(), 'voicetree-test-metrics');
  const testMetricsPath = path.join(testDir, 'agent_metrics.json');
  const originalHomedir = os.homedir;

  beforeEach(async () => {
    // Mock os.homedir to use test directory
    os.homedir = () => path.join(testDir, '..');

    // Create test directory
    await fs.mkdir(path.join(testDir, '..', 'Library', 'Application Support', 'VoiceTree'), { recursive: true });

    // Create initial metrics file with a test session
    const initialData = {
      sessions: [
        {
          sessionId: 'test-session-1',
          agentName: 'TestAgent',
          contextNode: 'test/node.md',
          startTime: '2025-12-21T10:00:00Z',
          endTime: '2025-12-21T10:05:00Z',
          durationMs: 300000,
        },
      ],
    };

    const metricsPath = path.join(testDir, '..', 'Library', 'Application Support', 'VoiceTree', 'agent_metrics.json');
    await fs.writeFile(metricsPath, JSON.stringify(initialData, null, 2), 'utf-8');
  });

  afterEach(async () => {
    // Restore original homedir
    os.homedir = originalHomedir;

    // Clean up test directory
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('should append token metrics to existing session', async () => {
    await appendTokenMetrics({
      sessionId: 'test-session-1',
      tokens: {
        input: 1000,
        output: 500,
        cacheRead: 200,
      },
      costUsd: 0.05,
    });

    const metricsPath = path.join(testDir, '..', 'Library', 'Application Support', 'VoiceTree', 'agent_metrics.json');
    const data = await fs.readFile(metricsPath, 'utf-8');
    const metrics = JSON.parse(data);

    expect(metrics.sessions).toHaveLength(1);
    expect(metrics.sessions[0].tokens).toEqual({
      input: 1000,
      output: 500,
      cacheRead: 200,
    });
    expect(metrics.sessions[0].costUsd).toBe(0.05);
  });

  it('should handle missing session gracefully', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await appendTokenMetrics({
      sessionId: 'non-existent-session',
      tokens: {
        input: 1000,
        output: 500,
      },
      costUsd: 0.05,
    });

    expect(consoleWarnSpy).toHaveBeenCalledWith('Session non-existent-session not found in metrics file');

    consoleWarnSpy.mockRestore();
  });

  it('should update tokens without cacheRead if not provided', async () => {
    await appendTokenMetrics({
      sessionId: 'test-session-1',
      tokens: {
        input: 1500,
        output: 750,
      },
      costUsd: 0.075,
    });

    const metricsPath = path.join(testDir, '..', 'Library', 'Application Support', 'VoiceTree', 'agent_metrics.json');
    const data = await fs.readFile(metricsPath, 'utf-8');
    const metrics = JSON.parse(data);

    expect(metrics.sessions[0].tokens).toEqual({
      input: 1500,
      output: 750,
    });
    expect(metrics.sessions[0].tokens.cacheRead).toBeUndefined();
  });
});
