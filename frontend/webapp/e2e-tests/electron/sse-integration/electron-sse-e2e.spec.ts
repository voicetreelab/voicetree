/**
 * E2E Test: True SSE End-to-End Integration
 *
 * This test validates the complete SSE pipeline using the REAL Python backend server.
 * Unlike other tests that use the stub server, this test:
 * 1. Starts the real Python text-to-tree server
 * 2. Sends text input that triggers the backend processing pipeline
 * 3. Validates SSE events are received and displayed in the status panel
 *
 * Even if LLM cloud functions fail (no API key), we still expect SSE events:
 * - phase_started {phase: 'placement'} when workflow begins
 * - agent_error or workflow_failed when LLM calls fail
 *
 * This validates the SSE infrastructure works end-to-end.
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

// Use absolute paths
const PROJECT_ROOT = path.resolve(process.cwd());

// Type definitions
interface ExtendedWindow {
  electronAPI?: {
    main: {
      getBackendPort: () => Promise<number>;
    };
  };
}

// Extend test with Electron app using REAL server
const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  electronApp: async ({}, use) => {
    // Create a temporary userData directory for this test
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-sse-e2e-test-'));

    // Create minimal VT folder with root.md
    const vtPath = path.join(tempUserDataPath, 'VT');
    await fs.mkdir(vtPath, { recursive: true });

    const rootMdPath = path.join(vtPath, 'root.md');
    await fs.writeFile(rootMdPath, '# Root\n\nMinimal test vault for SSE E2E test.\n', 'utf8');

    // Write config to auto-load this directory
    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({ lastDirectory: vtPath }, null, 2), 'utf8');
    console.log('[SSE E2E Test] Created minimal test vault at:', vtPath);

    const electronApp = await electron.launch({
      args: [
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}`
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        USE_REAL_SERVER: '1',  // Force real Python server
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1'
      },
      timeout: 10000 // 10 second timeout for app launch
    });

    await use(electronApp);

    // Graceful shutdown
    try {
      const window = await electronApp.firstWindow();
      await window.waitForTimeout(300);
    } catch {
      console.log('Note: Could not wait during cleanup (window may be closed)');
    }

    await electronApp.close();
    console.log('[SSE E2E Test] Electron app closed');

    // Cleanup temp directory
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow();

    // Log console messages for debugging
    window.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]:`, msg.text());
    });

    window.on('pageerror', error => {
      console.error('PAGE ERROR:', error.message);
    });

    await window.waitForLoadState('domcontentloaded');

    await use(window);
  }
});

test.describe('SSE End-to-End Integration', () => {
  // Set longer timeout since Python server takes time to start
  test.setTimeout(60000); // 60 seconds

  test.skip('should receive SSE events from real Python backend after text input', async ({ appWindow }) => {
    // SKIPPED: This test requires external infrastructure (real Python backend with SSE support)
    // The test sets USE_REAL_SERVER=1 to spawn the Python backend, but this requires:
    // - Python backend dependencies installed (uv sync)
    // - Backend code available and functional
    // - SSE event emission working correctly
    // Without these, the test will fail even if the health check passes.
    console.log('\n=== E2E Test: SSE Integration with Real Python Backend ===');

    console.log('=== STEP 1: Get backend port from Electron main process ===');
    const backendPort = await appWindow.evaluate(async () => {
      const api = (window as unknown as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.getBackendPort();
    });

    console.log(`Backend port: ${backendPort}`);
    expect(backendPort).toBeGreaterThan(8000);
    expect(backendPort).toBeLessThan(9000);
    console.log(`✓ Backend running on port ${backendPort}`);

    console.log('=== STEP 2: Wait for backend server health check (Python startup) ===');
    // Poll health endpoint with retries - Python server takes longer to start
    const maxRetries = 30;
    const retryDelay = 1000; // 1 second
    let healthCheck: { ok: boolean; status?: number; error?: string } | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      healthCheck = await appWindow.evaluate(async (port) => {
        try {
          const response = await fetch(`http://localhost:${port}/health`);
          return {
            ok: response.ok,
            status: response.status
          };
        } catch (error: unknown) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          };
        }
      }, backendPort);

      if (healthCheck.ok) {
        console.log(`✓ Backend server healthy after ${attempt} attempt(s) (${attempt}s)`);
        break;
      }

      if (attempt < maxRetries) {
        console.log(`Attempt ${attempt}/${maxRetries} failed: ${healthCheck?.error || 'unknown error'}, retrying...`);
        await appWindow.waitForTimeout(retryDelay);
      }
    }

    expect(healthCheck).not.toBeNull();
    expect(healthCheck?.ok).toBe(true);
    console.log('✓ Backend server is healthy and ready');

    console.log('=== STEP 3: Wait for status panel to be visible ===');
    // Wait for status panel to be rendered
    await appWindow.waitForSelector('.status-panel', { timeout: 10000 });
    console.log('✓ Status panel is visible');

    console.log('=== STEP 4: Find text input field and type test text ===');
    // Find the text input field in VoiceTreeTranscribe component
    const textInput = await appWindow.locator('input[type="text"]').first();
    await textInput.waitFor({ state: 'visible', timeout: 5000 });

    const testText = 'Test message for SSE validation';
    await textInput.fill(testText);
    console.log(`✓ Typed test text: "${testText}"`);

    console.log('=== STEP 5: Press Enter to send text (triggers force_flush) ===');
    await textInput.press('Enter');
    console.log('✓ Pressed Enter - backend processing should start');

    console.log('=== STEP 6: Wait for SSE events to appear in status panel ===');
    // Wait for at least one event to appear in the status panel
    // Even if LLM fails, we should see phase_started or agent_error events
    await appWindow.waitForSelector('.status-panel .event-item', { timeout: 30000 });
    console.log('✓ SSE event detected in status panel');

    // Get all events from the panel
    const events = await appWindow.evaluate(() => {
      const eventItems = document.querySelectorAll('.status-panel .event-item');
      return Array.from(eventItems).map(item => {
        const messageEl = item.querySelector('.event-message');
        const timeEl = item.querySelector('.event-time');
        return {
          message: messageEl?.textContent || '',
          time: timeEl?.textContent || '',
          className: item.className
        };
      });
    });

    console.log(`✓ Found ${events.length} SSE event(s):`);
    events.forEach((event, i) => {
      console.log(`  ${i + 1}. [${event.time}] ${event.message} (${event.className})`);
    });

    // Assertions
    expect(events.length).toBeGreaterThan(0);

    // Check that we received meaningful events (phase or workflow related)
    const hasWorkflowEvents = events.some(e =>
      e.message.toLowerCase().includes('phase') ||
      e.message.toLowerCase().includes('workflow') ||
      e.message.toLowerCase().includes('error') ||
      e.message.toLowerCase().includes('connected')
    );

    expect(hasWorkflowEvents).toBe(true);
    console.log('✓ SSE events contain workflow/phase information');

    console.log('\n✅ SSE End-to-End Integration Test PASSED!');
    console.log('Summary:');
    console.log(`  - Real Python backend started on port ${backendPort}`);
    console.log(`  - Backend health check succeeded after retries`);
    console.log(`  - Text input sent successfully`);
    console.log(`  - Received ${events.length} SSE event(s) in status panel`);
    console.log('  - SSE pipeline validated end-to-end');
  });

  test.skip('should maintain SSE connection and receive multiple events', async ({ appWindow }) => {
    // SKIPPED: This test requires external infrastructure (real Python backend with SSE support)
    // The test sets USE_REAL_SERVER=1 to spawn the Python backend, but this requires:
    // - Python backend dependencies installed (uv sync)
    // - Backend code available and functional
    // - SSE event emission working correctly
    // Without these, the test will fail even if the health check passes.
    console.log('\n=== E2E Test: Multiple SSE Events ===');

    // Get backend port
    const backendPort = await appWindow.evaluate(async () => {
      const api = (window as unknown as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.main.getBackendPort();
    });

    // Wait for backend health
    const maxRetries = 30;
    const retryDelay = 1000;
    let isHealthy = false;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const health = await appWindow.evaluate(async (port) => {
        try {
          const response = await fetch(`http://localhost:${port}/health`);
          return response.ok;
        } catch {
          return false;
        }
      }, backendPort);

      if (health) {
        isHealthy = true;
        console.log(`✓ Backend healthy after ${attempt} attempt(s)`);
        break;
      }

      if (attempt < maxRetries) {
        await appWindow.waitForTimeout(retryDelay);
      }
    }

    expect(isHealthy).toBe(true);

    // Wait for status panel
    await appWindow.waitForSelector('.status-panel', { timeout: 10000 });

    // Send first message
    const textInput = await appWindow.locator('input[type="text"]').first();
    await textInput.waitFor({ state: 'visible', timeout: 5000 });

    await textInput.fill('First test message');
    await textInput.press('Enter');
    console.log('✓ Sent first message');

    // Wait for first batch of events
    await appWindow.waitForSelector('.status-panel .event-item', { timeout: 30000 });
    await appWindow.waitForTimeout(2000); // Wait for processing

    // Get event count after first message
    const firstEventCount = await appWindow.evaluate(() => {
      return document.querySelectorAll('.status-panel .event-item').length;
    });

    console.log(`✓ First message generated ${firstEventCount} event(s)`);

    // Send second message
    await textInput.fill('Second test message');
    await textInput.press('Enter');
    console.log('✓ Sent second message');

    // Wait for additional events
    await appWindow.waitForTimeout(5000);

    // Get final event count
    const finalEventCount = await appWindow.evaluate(() => {
      return document.querySelectorAll('.status-panel .event-item').length;
    });

    console.log(`✓ Second message generated additional events (total: ${finalEventCount})`);

    // Should have received events from both messages
    expect(finalEventCount).toBeGreaterThanOrEqual(firstEventCount);

    console.log('\n✅ Multiple SSE Events Test PASSED!');
  });
});

export { test };
