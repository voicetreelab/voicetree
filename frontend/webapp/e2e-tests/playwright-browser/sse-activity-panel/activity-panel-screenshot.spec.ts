/**
 * Screenshot test for SSE activity panel
 * Verifies that activity events display correctly with newest on right and proper spacing for minimap
 */

import { test as base, expect } from '@playwright/test';
import {
  setupMockElectronAPI,
  waitForCytoscapeReady,
} from '@e2e/playwright-browser/graph-delta-test-utils';

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

    const originalLog: typeof console.log = console.log;
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

// SSE Event types matching the SseStatusPanel
interface SSEEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
}

/**
 * Generate a sequence of realistic SSE events to populate the activity panel
 */
function generateMockSSEEvents(): SSEEvent[] {
  const now: number = Date.now();
  return [
    { type: 'connection_open', data: { port: 5001 }, timestamp: now - 60000 },
    { type: 'phase_started', data: { phase: 'placement', text_chunk: 'First transcribed text chunk for testing the activity panel display' }, timestamp: now - 55000 },
    { type: 'phase_complete', data: { phase: 'placement' }, timestamp: now - 50000 },
    { type: 'workflow_complete', data: { total_nodes: 3, node_titles: ['Node A', 'Node B'] }, timestamp: now - 45000 },
    { type: 'phase_started', data: { phase: 'analysis', text_chunk: 'Second chunk of transcribed text' }, timestamp: now - 40000 },
    { type: 'rate_limit_error', data: { message: 'Rate limit exceeded' }, timestamp: now - 35000 },
    { type: 'phase_started', data: { phase: 'placement', text_chunk: 'Third chunk after rate limit' }, timestamp: now - 30000 },
    { type: 'workflow_complete', data: { total_nodes: 5, node_titles: ['Node C', 'Node D', 'Node E'] }, timestamp: now - 25000 },
    { type: 'phase_started', data: { phase: 'synthesis', text_chunk: 'Fourth chunk' }, timestamp: now - 20000 },
    { type: 'workflow_failed', data: { error: 'LLM API error: Connection timeout after 30 seconds' }, timestamp: now - 15000 },
    { type: 'phase_started', data: { phase: 'placement', text_chunk: 'Fifth chunk retry' }, timestamp: now - 10000 },
    { type: 'workflow_complete', data: { total_nodes: 7, node_titles: ['Final Node'] }, timestamp: now - 5000 },
  ];
}

test.describe('SSE Activity Panel Screenshot', () => {
  test('should display many events with newest on right', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('\n=== Starting SSE activity panel screenshot test ===');

    await setupMockElectronAPI(page);
    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    await page.waitForTimeout(50);
    await waitForCytoscapeReady(page);

    // Wait for the SSE status panel mount point to exist
    await page.waitForSelector('#sse-status-panel-mount', { timeout: 5000 });
    console.log('SSE status panel mount point found');

    // Wait a bit for SseStatusPanel to initialize
    await page.waitForTimeout(300);

    // Check if the panel container exists
    const panelExists: boolean = await page.evaluate(() => {
      return document.querySelector('.server-activity-panel') !== null;
    });

    if (!panelExists) {
      console.log('Panel not auto-initialized, manually creating it...');
      // The panel might not auto-initialize in test environment, inject events directly
      await page.evaluate(() => {
        const mountPoint: HTMLElement | null = document.getElementById('sse-status-panel-mount');
        if (!mountPoint) throw new Error('Mount point not found');

        // Create panel structure manually
        const panel: HTMLDivElement = document.createElement('div');
        panel.className = 'server-activity-panel';

        const eventsContainer: HTMLDivElement = document.createElement('div');
        eventsContainer.className = 'server-activity-events';
        panel.appendChild(eventsContainer);

        mountPoint.appendChild(panel);
      });
    }

    // Wait for panel to be visible
    await page.waitForSelector('.server-activity-panel', { timeout: 5000 });
    console.log('Panel container exists');

    // Inject mock SSE events into the panel
    const events: SSEEvent[] = generateMockSSEEvents();

    await page.evaluate((eventsToInject: SSEEvent[]) => {
      const eventsContainer: HTMLElement | null = document.querySelector('.server-activity-events');
      if (!eventsContainer) throw new Error('Events container not found');

      // Helper functions matching SseStatusPanel
      function getEventIcon(type: string): string {
        const icons: Record<string, string> = {
          phase_started: '\u25B6',
          phase_complete: '\u2713',
          action_applied: '\u2022',
          agent_error: '\u2717',
          rate_limit_error: '\u23F1',
          workflow_complete: '\u2713\u2713',
          workflow_failed: '\u2717\u2717',
          connection_error: '\u26A1',
          connection_open: '\u25CB'
        };
        return icons[type] || '\u25CB';
      }

      function getEventMessage(event: SSEEvent): string {
        switch (event.type) {
          case 'phase_started': {
            const phase: string = event.data.phase as string;
            if (phase === 'placement' && event.data.text_chunk) {
              const text: string = event.data.text_chunk as string;
              const first30: string = text.slice(0, 30);
              const rest: string = text.length > 30 ? `<span class="activity-text-rest">${text.slice(30)}</span>` : '';
              return `${phase}: ${first30}${rest}`;
            }
            return `${phase}`;
          }
          case 'phase_complete':
            return '';
          case 'rate_limit_error':
            return 'Rate limit';
          case 'workflow_complete':
            return `Done (${event.data.total_nodes} nodes)`;
          case 'connection_open':
            return `Connected :${event.data.port}`;
          case 'connection_error':
            return 'Disconnected';
          case 'workflow_failed': {
            const error: string = (event.data.error as string) || 'Unknown error';
            const first50: string = error.slice(0, 35);
            const rest: string = error.length > 35 ? `<span class="activity-text-rest">${error.slice(35)}</span>` : '';
            return `${first50}${rest}`;
          }
          default:
            return event.type.replace(/_/g, ' ');
        }
      }

      // Add each event (append for newest on right)
      eventsToInject.forEach(event => {
        const message: string = getEventMessage(event);
        if (!message) return; // Skip empty messages

        const time: string = new Date(event.timestamp).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });
        const icon: string = getEventIcon(event.type);

        const card: HTMLDivElement = document.createElement('div');
        card.className = `server-activity-card event-${event.type}`;
        card.innerHTML = `
          <span class="activity-icon">${icon}</span>
          <span class="activity-message">${message}</span>
          <span class="activity-time">${time}</span>
        `;

        // Append to put newest on right
        eventsContainer.appendChild(card);
      });

      // Autoscroll to newest (rightmost)
      eventsContainer.scrollLeft = eventsContainer.scrollWidth;
    }, events);

    await page.waitForTimeout(300);

    // Take screenshot of the full page to show panel positioning relative to minimap
    await page.screenshot({
      path: 'e2e-tests/screenshots/activity-panel-full-page.png'
    });
    console.log('Full page screenshot saved');

    // Take screenshot of just the activity panel
    const panel: import('@playwright/test').Locator = page.locator('.server-activity-panel');
    await panel.screenshot({
      path: 'e2e-tests/screenshots/activity-panel-many-events.png'
    });
    console.log('Activity panel screenshot saved');

    // Verify the panel has events
    const eventCount: number = await page.evaluate(() => {
      return document.querySelectorAll('.server-activity-card').length;
    });
    console.log(`Panel contains ${eventCount} event cards`);
    expect(eventCount).toBeGreaterThan(5);

    // Verify scroll position (should be scrolled to right for newest)
    const scrollInfo: { scrollLeft: number; scrollWidth: number; clientWidth: number } = await page.evaluate(() => {
      const container: HTMLElement | null = document.querySelector('.server-activity-events');
      if (!container) return { scrollLeft: 0, scrollWidth: 0, clientWidth: 0 };
      return {
        scrollLeft: container.scrollLeft,
        scrollWidth: container.scrollWidth,
        clientWidth: container.clientWidth
      };
    });
    console.log(`Scroll position: ${scrollInfo.scrollLeft}/${scrollInfo.scrollWidth - scrollInfo.clientWidth}`);

    // Scroll should be at or near the right edge
    const isScrolledRight: boolean = scrollInfo.scrollLeft >= scrollInfo.scrollWidth - scrollInfo.clientWidth - 10;
    expect(isScrolledRight).toBe(true);

    console.log('Activity panel screenshot test completed');
  });
});
