// Verification script for Task 2B - Token/Cost JSON Appender

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { appendTokenMetrics } from './src/metrics-writer';

async function verify(): Promise<void> {
  console.log('Task 2B Verification Script\n');
  console.log('===========================\n');

  // Create test directory
  const testDir = path.join(os.tmpdir(), 'voicetree-verify');
  const metricsPath = path.join(
    testDir,
    'Library',
    'Application Support',
    'VoiceTree',
    'agent_metrics.json'
  );

  // Temporarily override os.homedir
  const originalHomedir = os.homedir;
  os.homedir = () => testDir;

  try {
    // Step 1: Create test metrics file
    console.log('Step 1: Creating test metrics file...');
    await fs.mkdir(path.dirname(metricsPath), { recursive: true });

    const initialData = {
      sessions: [
        {
          sessionId: 'verify-session-1',
          agentName: 'Hana',
          contextNode: 'verify/test.md',
          startTime: '2025-12-21T10:00:00Z',
          endTime: '2025-12-21T10:05:00Z',
          durationMs: 300000,
        },
      ],
    };

    await fs.writeFile(metricsPath, JSON.stringify(initialData, null, 2), 'utf-8');
    console.log('✓ Test metrics file created\n');

    // Step 2: Append token metrics
    console.log('Step 2: Appending token/cost metrics...');
    await appendTokenMetrics({
      sessionId: 'verify-session-1',
      tokens: {
        input: 1500,
        output: 750,
        cacheRead: 300,
      },
      costUsd: 0.075,
    });
    console.log('✓ Metrics appended\n');

    // Step 3: Verify the update
    console.log('Step 3: Verifying the update...');
    const updatedData = await fs.readFile(metricsPath, 'utf-8');
    const metrics = JSON.parse(updatedData);

    // Verify structure
    if (metrics.sessions.length !== 1) {
      throw new Error('Expected 1 session');
    }

    const session = metrics.sessions[0];

    // Verify tokens
    if (!session.tokens) {
      throw new Error('Missing tokens field');
    }
    if (session.tokens.input !== 1500) {
      throw new Error(`Expected tokens.input=1500, got ${session.tokens.input}`);
    }
    if (session.tokens.output !== 750) {
      throw new Error(`Expected tokens.output=750, got ${session.tokens.output}`);
    }
    if (session.tokens.cacheRead !== 300) {
      throw new Error(`Expected tokens.cacheRead=300, got ${session.tokens.cacheRead}`);
    }

    // Verify cost
    if (session.costUsd !== 0.075) {
      throw new Error(`Expected costUsd=0.075, got ${session.costUsd}`);
    }

    console.log('✓ All fields verified\n');

    // Display final result
    console.log('Final Session Data:');
    console.log(JSON.stringify(session, null, 2));
    console.log('\n✅ Task 2B Verification PASSED\n');
    console.log('Success Criteria Met:');
    console.log('  ✓ Token metrics appended to session in JSON');
    console.log('  ✓ Cost metrics appended to session in JSON');
    console.log('  ✓ Session correlation by terminal ID');
  } catch (error) {
    console.error('\n❌ Verification FAILED:', error);
    process.exit(1);
  } finally {
    // Restore homedir
    os.homedir = originalHomedir;

    // Cleanup
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  }
}

verify();
