#!/usr/bin/env ts-node
/**
 * End-to-End Demo of Task 2B: Token/Cost JSON Appender
 *
 * This script demonstrates the complete flow:
 * 1. Create a test agent_metrics.json file with a session
 * 2. Send OTLP metrics via HTTP to the receiver
 * 3. Verify the metrics are appended to the JSON file
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { startServer } from './src/server';
import { appendTokenMetrics } from './src/metrics-writer';
import { ParsedMetrics } from './src/types';

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendOTLPMetrics(port: number, sessionId: string): Promise<unknown> {
  const payload = {
    resourceMetrics: [
      {
        resource: {
          attributes: [
            {
              key: 'VOICETREE_SESSION_ID',
              value: { stringValue: sessionId },
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
                      asInt: 2500,
                    },
                    {
                      attributes: [
                        { key: 'token_type', value: { stringValue: 'output' } },
                      ],
                      asInt: 1250,
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
                      asDouble: 0.125,
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

  const response = await fetch(`http://localhost:${port}/v1/metrics`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  return await response.json();
}

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  End-to-End Demo: Task 2B - Token/Cost JSON Appender');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Setup test environment
  const testDir = path.join(os.tmpdir(), 'voicetree-e2e-demo');
  const metricsPath = path.join(
    testDir,
    'Library',
    'Application Support',
    'VoiceTree',
    'agent_metrics.json'
  );

  const originalHomedir = os.homedir;
  os.homedir = () => testDir;

  try {
    // Step 1: Create initial metrics file
    console.log('Step 1: Creating initial agent_metrics.json with a test session...');
    await fs.mkdir(path.dirname(metricsPath), { recursive: true });

    const sessionId = 'demo-terminal-123';
    const initialData = {
      sessions: [
        {
          sessionId,
          agentName: 'Hana',
          contextNode: 'demo/task.md',
          startTime: '2025-12-21T10:00:00Z',
        },
      ],
    };

    await fs.writeFile(metricsPath, JSON.stringify(initialData, null, 2), 'utf-8');
    console.log('✓ Created:', metricsPath);
    console.log('✓ Initial session:', sessionId, '\n');

    // Step 2: Start OTLP receiver
    console.log('Step 2: Starting OTLP receiver on port 14318...');
    const server = await startServer(14318, 'localhost', async (metrics: ParsedMetrics) => {
      console.log('\n[Receiver] Parsed metrics from OTLP payload:');
      console.log('  Session ID:', metrics.sessionId);
      console.log('  Tokens:', metrics.tokens);
      console.log('  Cost:', `$${metrics.costUsd.toFixed(4)}\n`);

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
    console.log('✓ Server listening on http://localhost:14318\n');

    // Wait for server to be ready
    await sleep(500);

    // Step 3: Send OTLP metrics
    console.log('Step 3: Sending OTLP metrics via HTTP POST...');
    await sendOTLPMetrics(14318, sessionId);
    console.log('✓ Metrics sent successfully\n');

    // Wait for file write
    await sleep(500);

    // Step 4: Verify the update
    console.log('Step 4: Verifying metrics were appended to JSON file...');
    const updatedData = await fs.readFile(metricsPath, 'utf-8');
    const metrics = JSON.parse(updatedData);

    console.log('✓ File read successfully');
    console.log('\nFinal Session Data:');
    console.log('─'.repeat(60));
    console.log(JSON.stringify(metrics.sessions[0], null, 2));
    console.log('─'.repeat(60));

    // Validate
    const session = metrics.sessions[0];
    const validations = [
      { name: 'Session ID matches', pass: session.sessionId === sessionId },
      { name: 'Has tokens field', pass: session.tokens !== undefined },
      { name: 'Input tokens = 2500', pass: session.tokens?.input === 2500 },
      { name: 'Output tokens = 1250', pass: session.tokens?.output === 1250 },
      { name: 'Cache read tokens = 500', pass: session.tokens?.cacheRead === 500 },
      { name: 'Cost = $0.125', pass: session.costUsd === 0.125 },
    ];

    console.log('\nValidation Results:');
    console.log('─'.repeat(60));
    let allPassed = true;
    for (const validation of validations) {
      const status = validation.pass ? '✓' : '✗';
      console.log(`  ${status} ${validation.name}`);
      if (!validation.pass) allPassed = false;
    }
    console.log('─'.repeat(60));

    if (allPassed) {
      console.log('\n✅ END-TO-END DEMO SUCCESSFUL!');
      console.log('\nAll success criteria verified:');
      console.log('  ✓ Token metrics appended to session in JSON');
      console.log('  ✓ Cost metrics appended to session in JSON');
      console.log('  ✓ Session correlation by terminal ID');
    } else {
      console.log('\n❌ DEMO FAILED - Some validations did not pass');
      process.exit(1);
    }

    // Cleanup
    await server.close();
  } catch (error) {
    console.error('\n❌ Demo failed with error:', error);
    process.exit(1);
  } finally {
    // Restore
    os.homedir = originalHomedir;

    // Cleanup
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  Demo Complete');
  console.log('═══════════════════════════════════════════════════════════\n');
}

main();
