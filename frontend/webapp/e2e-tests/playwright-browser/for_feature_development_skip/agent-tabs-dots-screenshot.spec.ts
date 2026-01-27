import { test } from '@playwright/test';
import {
    setupMockElectronAPI,
  selectMockProject,
    waitForCytoscapeReady,
} from '@e2e/playwright-browser/graph-delta-test-utils';

test('screenshot agent tabs with activity dots', async ({ page }) => {
    await page.goto('/');
    await selectMockProject(page);
    await setupMockElectronAPI(page);
    await waitForCytoscapeReady(page);

    // Inject fake agent tabs with activity dots for screenshot
    await page.evaluate(() => {
        // Create the tabs bar structure matching real DOM structure
        const container = document.createElement('div');
        container.className = 'agent-tabs-bar';
        container.style.cssText = 'display: flex; position: absolute; top: 8px; left: 20px; z-index: 9999; background: #1a1a1a; padding: 8px; border-radius: 6px;';

        const pinnedContainer = document.createElement('div');
        pinnedContainer.className = 'agent-tabs-pinned';

        // Create two fake tabs
        for (let t = 0; t < 2; t++) {
            const tab = document.createElement('button');
            tab.className = 'agent-tab';
            tab.setAttribute('data-terminal-id', `test-terminal-${t}`);

            const text = document.createElement('span');
            text.className = 'agent-tab-text';
            text.textContent = t === 0 ? 'Agent Alpha' : 'Agent Beta';
            tab.appendChild(text);

            // Add dots: first tab gets 2 dots, second gets 3
            const dotCount = t === 0 ? 2 : 3;
            for (let i = 0; i < dotCount; i++) {
                const dot = document.createElement('span');
                dot.className = 'agent-tab-activity-dot';
                dot.style.left = `${4 + i * 12}px`;
                tab.appendChild(dot);
            }

            pinnedContainer.appendChild(tab);
        }

        container.appendChild(pinnedContainer);
        document.body.appendChild(container);
    });

    // Wait for rendering
    await page.waitForTimeout(300);

    // Take full page screenshot (element screenshot fails if element is too small/not in viewport)
    await page.screenshot({
        path: 'e2e-tests/screenshots/agent-tabs-dots.png',
        clip: { x: 0, y: 0, width: 500, height: 80 }
    });
});
