/**
 * Integration test for port-utils
 * Tests that multiple servers can be launched on consecutive ports
 * and all run successfully without conflicts.
 *
 * This test ACTUALLY spawns real Python backend servers to verify
 * port discovery works in real-world scenarios. Therefore it takes a long amount of time,
 * so we don't want it to auto-run with vitest.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { findAvailablePort, isPortAvailable } from '@/shell/edge/main/electron/port-utils';

describe('port-utils integration test', () => {
  const serverProcesses: ChildProcess[] = [];
  const assignedPorts: number[] = [];

  // Clean up all spawned servers after tests
  afterAll(async () => {
    console.log(`\n[Cleanup] Killing ${serverProcesses.length} spawned servers...`);
    for (const proc of serverProcesses) {
      if (proc && proc.pid) {
        try {
          proc.kill('SIGTERM');
          proc.kill('SIGKILL');
        } catch (err) {
          console.error('Error killing process:', err);
        }
      }
    }

    // Wait a bit for ports to be released
    await new Promise(resolve => setTimeout(resolve, 1000));
  });

  it('should launch 3 servers on consecutive ports and verify all are running', async () => {
    const repoRoot = path.resolve(__dirname, '../..');
    const serverScript = path.join(repoRoot, 'server.py');

    console.log(`\n[Test] Repository root: ${repoRoot}`);
    console.log(`[Test] Server script: ${serverScript}`);

    // Launch 3 servers
    for (let i = 0; i < 3; i++) {
      console.log(`\n[Test] === Launching server ${i + 1}/3 ===`);

      // Always start from 8001 - let port-utils find the next available port
      // This tests port-utils' ability to skip occupied ports
      const port = await findAvailablePort(8001);
      assignedPorts.push(port);

      console.log(`[Test] Found available port: ${port}`);

      // Verify port is actually available before spawning
      const portAvailable = await isPortAvailable(port);
      expect(portAvailable).toBe(true);

      // Spawn the Python server
      const serverProcess = spawn('python', ['server.py', port.toString()], {
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1' // Ensure immediate output
        }
      });

      serverProcesses.push(serverProcess);

      // Log server output for debugging
      serverProcess.stdout?.on('data', (data) => {
        const output = data.toString().trim();
        console.log(`[Server ${i + 1} stdout] ${output}`);
      });

      serverProcess.stderr?.on('data', (data) => {
        const output = data.toString().trim();
        console.log(`[Server ${i + 1} stderr] ${output}`);
      });

      serverProcess.on('error', (error) => {
        console.error(`[Server ${i + 1}] Failed to start:`, error);
      });

      serverProcess.on('exit', (code, signal) => {
        console.log(`[Server ${i + 1}] Exited with code ${code} and signal ${signal}`);
      });

      console.log(`[Test] Spawned server ${i + 1} with PID: ${serverProcess.pid} on port ${port}`);

      // CRITICAL: Wait for server to actually bind the port before launching next server
      // Otherwise findAvailablePort will return the same port again
      console.log(`[Test] Waiting for server ${i + 1} to bind port ${port}...`);

      let bound = false;
      for (let attempt = 0; attempt < 50; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 100)); // Wait 100ms
        const stillAvailable = await isPortAvailable(port);
        if (!stillAvailable) {
          console.log(`[Test] ✓ Server ${i + 1} has bound to port ${port}`);
          bound = true;
          break;
        }
      }

      if (!bound) {
        throw new Error(`Server ${i + 1} failed to bind port ${port} within 5 seconds`);
      }
    }

    console.log(`\n[Test] All servers spawned. Assigned ports: ${assignedPorts.join(', ')}`);

    // Verify ports are consecutive
    expect(assignedPorts).toHaveLength(3);
    expect(assignedPorts[1]).toBe(assignedPorts[0] + 1);
    expect(assignedPorts[2]).toBe(assignedPorts[1] + 1);
    console.log(`[Test] ✓ Ports are consecutive: ${assignedPorts[0]}, ${assignedPorts[1]}, ${assignedPorts[2]}`);

    // Wait for servers to start up (uvicorn takes a moment)
    console.log('\n[Test] Waiting 5 seconds for servers to initialize...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Verify all servers are actually running by hitting their /health endpoints
    console.log('\n[Test] === Verifying all servers are running ===');
    const healthCheckPromises = assignedPorts.map(async (port, index) => {
      console.log(`[Test] Checking health of server ${index + 1} on port ${port}...`);

      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`, {
          signal: AbortSignal.timeout(5000) // 5 second timeout
        });

        const data = await response.json() as { status: string; nodes: number };

        console.log(`[Test] Server ${index + 1} (port ${port}) health check: ${response.status} - ${JSON.stringify(data)}`);

        expect(response.ok).toBe(true);
        expect(response.status).toBe(200);
        expect(data).toHaveProperty('status');
        expect(data.status).toBe('healthy');

        return { port, healthy: true, data };
      } catch (error) {
        console.error(`[Test] Server ${index + 1} (port ${port}) health check FAILED:`, error);
        throw error;
      }
    });

    const healthResults = await Promise.all(healthCheckPromises);

    console.log('\n[Test] === Health Check Results ===');
    healthResults.forEach((result, index) => {
      console.log(`[Test] ✓ Server ${index + 1} (port ${result.port}): HEALTHY - ${JSON.stringify(result.data)}`);
    });

    // Final assertion: all 3 servers are healthy
    expect(healthResults).toHaveLength(3);
    expect(healthResults.every(r => r.healthy)).toBe(true);

    console.log('\n[Test] ✅ SUCCESS: All 3 servers launched on consecutive ports and are running!');
  }, 30000); // 30 second timeout for the whole test
});
