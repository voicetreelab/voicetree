import { test } from '@playwright/test';
import {
    setupMockElectronAPI,
    waitForCytoscapeReady,
} from '@e2e/playwright-browser/graph-delta-test-utils.ts';

test('screenshot recent node tabs with shortcut hints on hover', async ({ page }) => {
    await page.goto('/');
    await setupMockElectronAPI(page);
    await waitForCytoscapeReady(page);

    // Inject fake recent tabs for screenshot
    await page.evaluate(() => {
        // Create the tabs bar structure
        const container = document.createElement('div');
        container.className = 'recent-tabs-bar';
        container.style.cssText = 'display: flex; position: absolute; top: 8px; left: 80px; z-index: 9999;';

        const scroll = document.createElement('div');
        scroll.className = 'recent-tabs-scroll';

        const tabLabels = ['Project Setup', 'Auth Flow', 'Database Schema', 'API Routes', 'UI Components'];

        // Create 5 fake tabs with shortcut hints
        for (let i = 0; i < 5; i++) {
            const wrapper = document.createElement('div');
            wrapper.className = 'recent-tab-wrapper';

            const tab = document.createElement('button');
            tab.className = 'recent-tab';
            tab.setAttribute('data-node-id', `test-node-${i}`);
            tab.style.width = '90px';

            const text = document.createElement('span');
            text.className = 'recent-tab-text';
            text.textContent = tabLabels[i];
            tab.appendChild(text);

            const hint = document.createElement('span');
            hint.className = 'recent-tab-shortcut-hint';
            hint.innerHTML = `⌘${i + 1}`;

            wrapper.appendChild(tab);
            wrapper.appendChild(hint);
            scroll.appendChild(wrapper);
        }

        container.appendChild(scroll);
        document.body.appendChild(container);
    });

    // Wait for rendering
    await page.waitForTimeout(300);

    // Hover over the second tab to show its shortcut hint
    const secondTab = page.locator('.recent-tab-wrapper').nth(1);
    await secondTab.hover();

    // Wait for hover transition
    await page.waitForTimeout(200);

    // Force the hint to be visible (in case CSS hover state isn't captured)
    await page.evaluate(() => {
        const hoveredWrapper = document.querySelectorAll('.recent-tab-wrapper')[1];
        const hint = hoveredWrapper?.querySelector('.recent-tab-shortcut-hint') as HTMLElement;
        if (hint) {
            hint.style.opacity = '1';
        }
    });

    // Take screenshot showing tabs with hover hint visible
    await page.screenshot({
        path: 'e2e-tests/screenshots/recent-tabs-shortcut-hints.png',
        clip: { x: 60, y: 0, width: 550, height: 60 }
    });
});
