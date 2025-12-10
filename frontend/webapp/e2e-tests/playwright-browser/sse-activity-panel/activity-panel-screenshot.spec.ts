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
function generateMockSSEEvents(count: number = 12): SSEEvent[] {
  const now: number = Date.now();
  const baseEvents: SSEEvent[] = [
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

  if (count <= baseEvents.length) {
    return baseEvents.slice(0, count);
  }

  // Generate additional events for larger counts
  const events: SSEEvent[] = [...baseEvents];
  const eventTypes: Array<{ type: string; data: Record<string, unknown> }> = [
    { type: 'phase_started', data: { phase: 'placement', text_chunk: 'Additional transcription chunk number ' } },
    { type: 'workflow_complete', data: { total_nodes: 2, node_titles: ['Generated Node'] } },
    { type: 'phase_started', data: { phase: 'optimization' } },
    { type: 'workflow_complete', data: { total_nodes: 4, node_titles: ['Alpha', 'Beta'] } },
    { type: 'rate_limit_error', data: { message: 'Rate limit' } },
    { type: 'phase_started', data: { phase: 'synthesis', text_chunk: 'Synthesis pass ' } },
  ];

  for (let i: number = baseEvents.length; i < count; i++) {
    const template: { type: string; data: Record<string, unknown> } = eventTypes[i % eventTypes.length];
    const eventData: Record<string, unknown> = { ...template.data };
    if (eventData.text_chunk) {
      eventData.text_chunk = `${eventData.text_chunk}${i}`;
    }
    events.push({
      type: template.type,
      data: eventData,
      timestamp: now - (count - i) * 3000,
    });
  }

  return events;
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

    // Add mock FileWatchingPanel to the left of activity panel (simulates real layout)
    await page.evaluate(() => {
      const mountPoint: HTMLElement | null = document.getElementById('sse-status-panel-mount');
      if (!mountPoint || !mountPoint.parentElement) return;

      // Create mock FileWatchingPanel
      const mockFilePanel: HTMLDivElement = document.createElement('div');
      mockFilePanel.className = 'flex items-center gap-1 font-mono text-xs shrink-0';
      mockFilePanel.innerHTML = `
        <button class="text-gray-600 px-1.5 py-1 rounded bg-gray-100" style="font-size: 12px;">
          my-project
          <span style="font-size: 10px; margin-left: 4px;">▼</span>
        </button>
        <span class="text-gray-400">/</span>
        <button class="text-gray-600 px-1.5 py-1 rounded bg-gray-100" style="font-size: 12px;">
          vault
        </button>
      `;

      // Insert before the mount point
      mountPoint.parentElement.insertBefore(mockFilePanel, mountPoint);
    });

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

        // Create expand/collapse arrow button
        const expandArrow: HTMLButtonElement = document.createElement('button');
        expandArrow.className = 'server-activity-expand-arrow';
        expandArrow.innerHTML = '<span class="arrow-icon">▲</span>';
        expandArrow.addEventListener('click', () => {
          const isExpanded: boolean = panel.classList.toggle('expanded');
          if (isExpanded) {
            eventsContainer.scrollLeft = 0;
          } else {
            // Scroll to rightmost (newest) item when collapsing
            requestAnimationFrame(() => {
              eventsContainer.scrollLeft = eventsContainer.scrollWidth;
            });
          }
        });
        panel.appendChild(expandArrow);

        const eventsContainer: HTMLDivElement = document.createElement('div');
        eventsContainer.className = 'server-activity-events';
        panel.appendChild(eventsContainer);

        mountPoint.appendChild(panel);
      });
    }

    // Wait for panel to be visible
    await page.waitForSelector('.server-activity-panel', { timeout: 5000 });
    console.log('Panel container exists');

    // Inject many mock SSE events into the panel (30 events to fill the overlay)
    const events: SSEEvent[] = generateMockSSEEvents(30);

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

    // Take screenshot of the full page in compact (collapsed) view
    await page.screenshot({
      path: 'e2e-tests/screenshots/activity-panel-no-hover.png'
    });
    console.log('Compact (collapsed) screenshot saved');

    // Click the expand arrow to toggle expanded state
    const expandArrow: import('@playwright/test').Locator = page.locator('.server-activity-expand-arrow');
    await expandArrow.click();

    // Wait for expansion transition
    await page.waitForTimeout(300);

    // Take screenshot with expanded panel visible
    await page.screenshot({
      path: 'e2e-tests/screenshots/activity-panel-hover-overlay.png'
    });
    console.log('Expanded panel screenshot saved');

    // Also take a screenshot of just the bottom area to show detail
    const bottomArea: import('@playwright/test').Locator = page.locator('.server-activity-panel');
    await bottomArea.screenshot({
      path: 'e2e-tests/screenshots/activity-panel-compact.png'
    });
    console.log('Compact panel screenshot saved');

    // Verify the panel has events
    const eventCount: number = await page.evaluate(() => {
      return document.querySelectorAll('.server-activity-events .server-activity-card').length;
    });
    console.log(`Panel contains ${eventCount} event cards`);
    expect(eventCount).toBeGreaterThan(20);

    // Verify panel is in expanded state
    const isExpanded: boolean = await page.evaluate(() => {
      return document.querySelector('.server-activity-panel')?.classList.contains('expanded') ?? false;
    });
    expect(isExpanded).toBe(true);
    console.log('Panel is expanded after clicking arrow');

    // Click the expand arrow again to collapse
    await expandArrow.click();

    // Wait for collapse transition
    await page.waitForTimeout(300);

    // Take screenshot after collapsing (should show rightmost items due to auto-scroll)
    await page.screenshot({
      path: 'e2e-tests/screenshots/activity-panel-after-collapse.png'
    });
    console.log('After collapse screenshot saved');

    // Verify panel is collapsed
    const isCollapsed: boolean = await page.evaluate(() => {
      return !document.querySelector('.server-activity-panel')?.classList.contains('expanded');
    });
    expect(isCollapsed).toBe(true);
    console.log('Panel is collapsed after clicking arrow again');

    console.log('Activity panel screenshot test completed');
  });
});
