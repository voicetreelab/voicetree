import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { createOTLPServer } from './server';
import { appendTokenMetrics } from './metrics-writer';
import { FastifyInstance } from 'fastify';

describe('OTLP Receiver Integration', () => {
  let server: FastifyInstance;
  const testDir = path.join(os.tmpdir(), 'voicetree-integration-test');
  const metricsPath = path.join(testDir, 'Library', 'Application Support', 'VoiceTree', 'agent_metrics.json');
  const originalHomedir = os.homedir;

  beforeAll(async () => {
    // Mock os.homedir to use test directory
    os.homedir = () => testDir;

    // Create test directory structure
    await fs.mkdir(path.dirname(metricsPath), { recursive: true });

    // Create initial metrics file with a test session
    const initialData = {
      sessions: [
        {
          sessionId: 'integration-test-session',
          agentName: 'TestAgent',
          contextNode: 'test/integration.md',
          startTime: '2025-12-21T10:00:00Z',
        },
      ],
    };

    await fs.writeFile(metricsPath, JSON.stringify(initialData, null, 2), 'utf-8');

    // Create server
    server = createOTLPServer(async (metrics) => {
      await appendTokenMetrics({
        sessionId: metrics.sessionId,
        tokens: {
          input: metrics.tokens.input,
          output: metrics.tokens.output,
          cacheRead: metrics.tokens.cacheRead,
        },
        costUsd: metrics.costUsd,
      });
    });

    await server.listen({ port: 14318, host: 'localhost' });
  });

  afterAll(async () => {
    // Restore original homedir
    os.homedir = originalHomedir;

    // Close server
    await server.close();

    // Clean up test directory
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('should receive OTLP metrics and append to JSON file', async () => {
    // Send OTLP metrics request
    const otlpPayload = {
      resourceMetrics: [
        {
          resource: {
            attributes: [
              {
                key: 'VOICETREE_SESSION_ID',
                value: { stringValue: 'integration-test-session' },
              },
            ],
          },
          scopeMetrics: [
            {
              metrics: [
                {
                  name: 'claude_code.token.usage',
                  sum: {
                    dataPoints: [
                      {
                        attributes: [
                          { key: 'token_type', value: { stringValue: 'input' } },
                        ],
                        asInt: 2000,
                      },
                      {
                        attributes: [
                          { key: 'token_type', value: { stringValue: 'output' } },
                        ],
                        asInt: 1000,
                      },
                      {
                        attributes: [
                          { key: 'token_type', value: { stringValue: 'cache_read' } },
                        ],
                        asInt: 500,
                      },
                    ],
                  },
                },
                {
                  name: 'claude_code.cost.usage',
                  sum: {
                    dataPoints: [
                      {
                        attributes: [],
                        asDouble: 0.15,
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    const response = await server.inject({
      method: 'POST',
      url: '/v1/metrics',
      payload: otlpPayload,
      headers: {
        'content-type': 'application/json',
      },
    });

    expect(response.statusCode).toBe(200);

    const responseBody = JSON.parse(response.body);
    expect(responseBody.status).toBe('success');
    expect(responseBody.metrics).toMatchObject({
      sessionId: 'integration-test-session',
      tokens: {
        input: 2000,
        output: 1000,
        cacheRead: 500,
      },
      costUsd: 0.15,
    });

    // Wait a bit for the file write to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify the metrics were written to the JSON file
    const metricsData = await fs.readFile(metricsPath, 'utf-8');
    const metrics = JSON.parse(metricsData);

    expect(metrics.sessions).toHaveLength(1);
    expect(metrics.sessions[0]).toMatchObject({
      sessionId: 'integration-test-session',
      tokens: {
        input: 2000,
        output: 1000,
        cacheRead: 500,
      },
      costUsd: 0.15,
    });
  });
});
