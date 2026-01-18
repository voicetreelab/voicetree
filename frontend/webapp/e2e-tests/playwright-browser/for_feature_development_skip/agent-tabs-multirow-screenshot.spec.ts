import { test } from '@playwright/test';
import {
    setupMockElectronAPI,
    waitForCytoscapeReady,
} from '@e2e/playwright-browser/graph-delta-test-utils';

test('screenshot agent tabs with 12 tabs across multiple rows', async ({ page }) => {
    await page.goto('/');
    await setupMockElectronAPI(page);
    await waitForCytoscapeReady(page);

    // Inject 12 fake agent tabs with activity dots to show multi-row wrapping
    await page.evaluate(() => {
        // Create the tabs bar structure matching real DOM structure
        const container = document.createElement('div');
        container.className = 'agent-tabs-bar';
        container.style.cssText = 'display: flex; position: absolute; top: 8px; left: 20px; z-index: 9999; background: #1a1a1a; padding: 8px; border-radius: 6px;';

        const pinnedContainer = document.createElement('div');
        pinnedContainer.className = 'agent-tabs-pinned';

        const tabNames = [
            'Agent Alpha', 'Agent Beta', 'Agent Gamma', 'Agent Delta',
            'Agent Epsilon', 'Agent Zeta', 'Agent Eta', 'Agent Theta',
            'Agent Iota', 'Agent Kappa', 'Agent Lambda', 'Agent Mu'
        ];

        // Create 12 fake tabs
        for (let t = 0; t < 12; t++) {
            const wrapper = document.createElement('div');
            wrapper.className = 'agent-tab-wrapper';
            wrapper.setAttribute('data-terminal-id', `test-terminal-${t}`);

            const tab = document.createElement('button');
            tab.className = 'agent-tab';
            tab.setAttribute('data-terminal-id', `test-terminal-${t}`);

            // Add status dot
            const statusDot = document.createElement('span');
            statusDot.className = t % 3 === 0 ? 'agent-tab-status-done' : 'agent-tab-status-running';
            tab.appendChild(statusDot);

            const text = document.createElement('span');
            text.className = 'agent-tab-text';
            text.textContent = tabNames[t];
            tab.appendChild(text);

            // Add activity dots: varying counts to show the feature
            const dotCount = (t % 4) + 1; // 1-4 dots per tab
            for (let i = 0; i < dotCount; i++) {
                const dot = document.createElement('span');
                dot.className = 'agent-tab-activity-dot';
                dot.style.left = `${4 + i * 12}px`;
                tab.appendChild(dot);
            }

            wrapper.appendChild(tab);
            pinnedContainer.appendChild(wrapper);
        }

        container.appendChild(pinnedContainer);
        document.body.appendChild(container);
    });

    // Wait for rendering
    await page.waitForTimeout(300);

    // Take screenshot capturing multiple rows (470px max-width means ~5 tabs per row, so 12 tabs = 3 rows)
    // Height needs to accommodate 3 rows: 3 * (16px tab + 20px row-gap) + padding ≈ 150px
    await page.screenshot({
        path: 'e2e-tests/screenshots/agent-tabs-multirow-12-tabs.png',
        clip: { x: 0, y: 0, width: 520, height: 180 }
    });
});
