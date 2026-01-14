/**
 * Browser-based test for Agent Statistics panel "Recent Sessions" rendering
 *
 * Bug: The Recent Sessions section shows empty rows (gray lines) but no session data
 * is visible, even though the summary cards show correct statistics (58 sessions,
 * $11.29 cost, etc.)
 */

import { test as base, expect, type Page } from '@playwright/test';
import {
  waitForCytoscapeReady,
} from '@e2e/playwright-browser/graph-delta-test-utils';
import type { SessionMetric } from '@/shell/UI/views/hooks/useAgentMetrics';

/**
 * Generate a week's worth of realistic sample session data
 */
function generateWeekOfSessions(): SessionMetric[] {
  const sessions: SessionMetric[] = [];
  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const HOUR_MS = 60 * 60 * 1000;

  // Generate sessions across 7 days (roughly 8 sessions per day = ~56 sessions)
  for (let day = 0; day < 7; day++) {
    const dayStart = now - (day * DAY_MS);

    // Variable number of sessions per day (5-12)
    const sessionsPerDay = 5 + Math.floor(Math.random() * 8);

    for (let s = 0; s < sessionsPerDay; s++) {
      const sessionStart = dayStart - (s * 2 * HOUR_MS); // Sessions spread 2 hours apart
      const durationMs = 60000 + Math.floor(Math.random() * 600000); // 1-10 minutes
      const sessionEnd = sessionStart + durationMs;

      const inputTokens = 1000 + Math.floor(Math.random() * 10000);
      const outputTokens = 500 + Math.floor(Math.random() * 5000);
      const cacheRead = Math.random() > 0.3 ? Math.floor(Math.random() * 50000) : 0;

      // Cost roughly based on Claude pricing
      const costUsd = (inputTokens * 0.000003) + (outputTokens * 0.000015);

      sessions.push({
        sessionId: `session-day${day}-${s}`,
        agentName: ['Claude', 'Hana', 'Gemini'][Math.floor(Math.random() * 3)],
        contextNode: `task-${day}-${s}/task.md`,
        startTime: new Date(sessionStart).toISOString(),
        endTime: new Date(sessionEnd).toISOString(),
        durationMs,
        tokens: {
          input: inputTokens,
          output: outputTokens,
          cacheRead,
        },
        costUsd,
      });
    }
  }

  return sessions;
}

/**
 * Sets up mock Electron API with custom session data
 */
async function setupMockElectronAPIWithSessions(page: Page, sessions: SessionMetric[]): Promise<void> {
  await page.addInitScript((sessionsData) => {
    // Create a comprehensive mock of the Electron API
    const mockElectronAPI = {
      main: {
        applyGraphDeltaToDBAndMem: async () => ({ success: true }),
        applyGraphDeltaToDBThroughMem: async () => ({ success: true }),
        getGraph: async () => ({ nodes: {}, edges: [] }),
        getNode: async () => null,
        loadSettings: async () => ({
          terminalSpawnPathRelativeToWatchedDirectory: '../',
          agents: [{ name: 'Claude', command: './claude.sh' }],
          shiftEnterSendsOptionEnter: true
        }),
        saveSettings: async () => ({ success: true }),
        saveNodePositions: async () => ({ success: true }),
        startFileWatching: async () => ({ success: true, directory: '/mock' }),
        stopFileWatching: async () => ({ success: true }),
        getWatchStatus: async () => ({ isWatching: true, directory: '/mock' }),
        loadPreviousFolder: async () => ({ success: false }),
        getBackendPort: async () => 5001,
        getMetrics: async () => ({ sessions: sessionsData }),
        applyGraphDeltaToDBThroughMemUIAndEditorExposed: async () => ({ success: true }),
        applyGraphDeltaToDBThroughMemAndUIExposed: async () => ({ success: true }),
      },
      onWatchingStarted: () => {},
      onFileWatchingStopped: () => {},
      removeAllListeners: () => {},
      terminal: {
        spawn: async () => ({ success: false }),
        write: async () => {},
        resize: async () => {},
        kill: async () => {},
        onData: () => {},
        onExit: () => {}
      },
      positions: {
        save: async () => ({ success: true }),
        load: async () => ({ success: false, positions: {} })
      },
      onBackendLog: () => {},
      graph: {
        _graphState: { nodes: {}, edges: [] },
        applyGraphDelta: async () => ({ success: true }),
        getState: async () => mockElectronAPI.graph._graphState,
        onGraphUpdate: (callback: (delta: unknown) => void) => {
          mockElectronAPI.graph._updateCallback = callback;
          return () => {};
        },
        onGraphClear: () => () => {},
        _updateCallback: undefined as ((delta: unknown) => void) | undefined
      },
      invoke: async () => {},
      _ipcListeners: {} as Record<string, ((event: unknown, ...args: unknown[]) => void)[]>,
      on: (channel: string, callback: (event: unknown, ...args: unknown[]) => void) => {
        if (!mockElectronAPI._ipcListeners[channel]) {
          mockElectronAPI._ipcListeners[channel] = [];
        }
        mockElectronAPI._ipcListeners[channel].push(callback);
        return () => {};
      },
      off: () => {},
      _triggerIpc: () => {}
    };

    (window as unknown as { electronAPI: typeof mockElectronAPI }).electronAPI = mockElectronAPI;
  }, sessions);
}

// Custom fixture to capture console logs and only show on failure
type ConsoleCapture = {
  consoleLogs: string[];
  pageErrors: string[];
  testLogs: string[];
};

const test = base.extend<{ consoleCapture: ConsoleCapture }>({
  consoleCapture: async ({ page }, use, testInfo) => {
    const consoleLogs: string[] = [];
    const pageErrors: string[] = [];
    const testLogs: string[] = [];

    page.on('console', msg => {
      consoleLogs.push(`[Browser ${msg.type()}] ${msg.text()}`);
    });

    page.on('pageerror', error => {
      pageErrors.push(`[Browser Error] ${error.message}\n${error.stack ?? ''}`);
    });

    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      testLogs.push(args.map(arg => String(arg)).join(' '));
    };

    await use({ consoleLogs, pageErrors, testLogs });

    console.log = originalLog;

    if (testInfo.status !== 'passed') {
      console.log('\n=== Test Logs ===');
      testLogs.forEach(log => console.log(log));
      console.log('\n=== Browser Console Logs ===');
      consoleLogs.forEach(log => console.log(log));
      if (pageErrors.length > 0) {
        console.log('\n=== Browser Errors ===');
        pageErrors.forEach(err => console.log(err));
      }
    }
  }
});

test.describe('Agent Statistics Panel - Recent Sessions', () => {
  test('should render session rows with visible content for a week of sessions', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('\n=== Starting Recent Sessions rendering test ===');

    // Generate a week's worth of sample session data
    const sessions = generateWeekOfSessions();
    console.log(`Generated ${sessions.length} test sessions`);

    console.log('=== Step 1: Setup mock Electron API with session data ===');
    await setupMockElectronAPIWithSessions(page, sessions);
    console.log('OK Electron API mock with sessions prepared');

    console.log('=== Step 2: Navigate to app ===');
    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    console.log('OK React rendered');

    await page.waitForTimeout(50);

    console.log('=== Step 3: Wait for Cytoscape ===');
    await waitForCytoscapeReady(page);
    console.log('OK Cytoscape initialized');

    console.log('=== Step 4: Open Agent Statistics panel ===');
    await page.evaluate(() => {
      window.dispatchEvent(new Event('toggle-stats-panel'));
    });
    await page.waitForTimeout(200); // Wait for data to load
    console.log('OK Stats panel opened');

    console.log('=== Step 5: Verify panel is visible and has data ===');
    const panelContainer = page.locator('[data-testid="agent-stats-panel-container"]');
    await expect(panelContainer).toBeVisible({ timeout: 3000 });

    // Wait for sessions to load (no longer showing "Loading sessions...")
    await page.waitForFunction(() => {
      const panel = document.querySelector('[data-testid="agent-stats-panel"]');
      return panel && !panel.textContent?.includes('Loading sessions...');
    }, { timeout: 5000 });
    console.log('OK Panel loaded with data');

    console.log('=== Step 6: Take screenshot of Recent Sessions section ===');
    await page.screenshot({
      path: 'e2e-tests/screenshots/agent-stats-recent-sessions.png',
      fullPage: true
    });
    console.log('OK Screenshot taken: agent-stats-recent-sessions.png');

    console.log('=== Step 7: Verify session rows are rendered ===');
    const sessionRows = page.locator('[data-testid="session-row"]');
    const rowCount = await sessionRows.count();
    console.log(`Found ${rowCount} session rows`);
    expect(rowCount).toBeGreaterThan(0);

    console.log('=== Step 8: Verify session data is visible in rows ===');
    // Check that agent names are visible in the first few rows
    const agentNames = page.locator('[data-testid="session-agent-name"]');
    const firstAgentName = await agentNames.first().textContent();
    console.log(`First agent name: "${firstAgentName}"`);
    expect(firstAgentName).toBeTruthy();
    expect(firstAgentName!.length).toBeGreaterThan(0);

    // Check that session costs are visible
    const sessionCosts = page.locator('[data-testid="session-cost"]');
    const firstCost = await sessionCosts.first().textContent();
    console.log(`First session cost: "${firstCost}"`);
    expect(firstCost).toBeTruthy();
    expect(firstCost).toContain('$');

    // Check that session durations are visible
    const sessionDurations = page.locator('[data-testid="session-duration"]');
    const firstDuration = await sessionDurations.first().textContent();
    console.log(`First session duration: "${firstDuration}"`);
    expect(firstDuration).toBeTruthy();

    console.log('=== Step 9: Verify summary cards match session count ===');
    const sessionsCountEl = page.locator('[data-testid="sessions-count"]');
    const sessionsCountText = await sessionsCountEl.textContent();
    console.log(`Sessions count in summary card: ${sessionsCountText}`);
    expect(parseInt(sessionsCountText ?? '0')).toBe(sessions.length);

    console.log('OK Recent Sessions rendering test completed successfully');
  });

  test('should not have empty/invisible session rows', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('\n=== Starting session row visibility test ===');

    const sessions = generateWeekOfSessions();
    await setupMockElectronAPIWithSessions(page, sessions);

    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    await page.waitForTimeout(50);
    await waitForCytoscapeReady(page);

    await page.evaluate(() => {
      window.dispatchEvent(new Event('toggle-stats-panel'));
    });
    await page.waitForTimeout(200);

    const panelContainer = page.locator('[data-testid="agent-stats-panel-container"]');
    await expect(panelContainer).toBeVisible({ timeout: 3000 });

    // Wait for data to load
    await page.waitForFunction(() => {
      const rows = document.querySelectorAll('[data-testid="session-row"]');
      return rows.length > 0;
    }, { timeout: 5000 });

    // Check that each session row has visible content (non-empty height)
    const sessionRows = page.locator('[data-testid="session-row"]');
    const rowCount = await sessionRows.count();

    // Check first 5 rows to ensure they have meaningful content
    const rowsToCheck = Math.min(5, rowCount);
    for (let i = 0; i < rowsToCheck; i++) {
      const row = sessionRows.nth(i);
      const boundingBox = await row.boundingBox();

      // Debug: log row details
      const rowDetails = await row.evaluate((el) => {
        const styles = window.getComputedStyle(el);
        const button = el.querySelector('button');
        const buttonStyles = button ? window.getComputedStyle(button) : null;
        const agentNameEl = el.querySelector('[data-testid="session-agent-name"]');
        const agentNameStyles = agentNameEl ? window.getComputedStyle(agentNameEl) : null;
        return {
          rowHeight: styles.height,
          rowOverflow: styles.overflow,
          buttonHeight: buttonStyles?.height,
          buttonPadding: buttonStyles?.padding,
          agentNameText: agentNameEl?.textContent,
          agentNameColor: agentNameStyles?.color,
          agentNameFontSize: agentNameStyles?.fontSize,
          agentNameDisplay: agentNameStyles?.display,
        };
      });
      console.log(`Row ${i} details:`, JSON.stringify(rowDetails, null, 2));

      expect(boundingBox).not.toBeNull();
      // Row should have reasonable height (at least 24px for content)
      expect(boundingBox!.height).toBeGreaterThan(24);

      // Row should have visible text content
      const textContent = await row.textContent();
      expect(textContent).toBeTruthy();
      expect(textContent!.trim().length).toBeGreaterThan(5); // More than just whitespace
    }

    console.log('OK All checked session rows have visible content');
  });
});
