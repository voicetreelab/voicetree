import { test } from '@playwright/test';
import {
    setupMockElectronAPI,
    waitForCytoscapeReady,
} from '@e2e/playwright-browser/graph-delta-test-utils';

test('screenshot agent tab with both active (purple) and inactive (green) overlays', async ({ page }) => {
    await page.goto('/');
    await setupMockElectronAPI(page);
    await waitForCytoscapeReady(page);

    // Inject fake agent tabs to demonstrate dual overlay visibility
    await page.evaluate(() => {
        const container = document.createElement('div');
        container.className = 'agent-tabs-bar';
        container.style.cssText = 'display: flex; position: absolute; top: 12px; left: 20px; z-index: 9999; background: #1a1a1a; padding: 10px; border-radius: 6px; gap: 8px;';

        const scroll = document.createElement('div');
        scroll.className = 'agent-tabs-scroll';
        scroll.style.cssText = 'display: flex; gap: 8px;';

        // Tab 1: Only active (purple outline)
        const tab1 = document.createElement('button');
        tab1.className = 'agent-tab agent-tab-active';
        tab1.setAttribute('data-terminal-id', 'test-terminal-0');
        const text1 = document.createElement('span');
        text1.className = 'agent-tab-text';
        text1.textContent = 'Active Only';
        tab1.appendChild(text1);
        scroll.appendChild(tab1);

        // Tab 2: Only inactive (green border)
        const tab2 = document.createElement('button');
        tab2.className = 'agent-tab agent-tab-inactive';
        tab2.setAttribute('data-terminal-id', 'test-terminal-1');
        const text2 = document.createElement('span');
        text2.className = 'agent-tab-text';
        text2.textContent = 'Done Only';
        tab2.appendChild(text2);
        scroll.appendChild(tab2);

        // Tab 3: Both active AND inactive (should show both purple outline and green border)
        const tab3 = document.createElement('button');
        tab3.className = 'agent-tab agent-tab-active agent-tab-inactive';
        tab3.setAttribute('data-terminal-id', 'test-terminal-2');
        const text3 = document.createElement('span');
        text3.className = 'agent-tab-text';
        text3.textContent = 'Both States';
        tab3.appendChild(text3);
        scroll.appendChild(tab3);

        container.appendChild(scroll);
        document.body.appendChild(container);
    });

    await page.waitForTimeout(300);

    await page.screenshot({
        path: 'e2e-tests/screenshots/agent-tabs-dual-overlay.png',
        clip: { x: 0, y: 0, width: 380, height: 70 }
    });
});
