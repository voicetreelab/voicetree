import { test } from '@playwright/test';
import {
    setupMockElectronAPI,
    waitForCytoscapeReady,
} from '@e2e/playwright-browser/graph-delta-test-utils';

test('screenshot agent tabs with directional shortcut hints on hover', async ({ page }) => {
    await page.goto('/');
    await setupMockElectronAPI(page);
    await waitForCytoscapeReady(page);

    // Inject fake agent tabs bar for screenshot
    // Simulates 4 terminals where the 2nd one (index 1) is active
    await page.evaluate(() => {
        // Create the agent tabs bar structure
        const container = document.createElement('div');
        container.className = 'agent-tabs-bar';
        container.style.cssText = 'display: flex; position: absolute; top: 8px; right: 12px; z-index: 9999; height: 38px; overflow: visible;';

        const scroll = document.createElement('div');
        scroll.className = 'agent-tabs-scroll';
        scroll.style.cssText = 'display: flex; gap: 4px; padding: 2px 24px 20px 4px; overflow: visible;';

        const tabLabels = ['claude-agent-1', 'main-terminal', 'test-runner', 'build-watcher'];
        const activeIndex = 1; // Second tab is active

        // Create 4 fake agent tabs with directional shortcut hints
        for (let i = 0; i < 4; i++) {
            const wrapper = document.createElement('div');
            wrapper.className = 'agent-tab-wrapper';

            const tab = document.createElement('button');
            tab.className = 'agent-tab';
            if (i === activeIndex) {
                tab.classList.add('agent-tab-active');
            }
            tab.setAttribute('data-terminal-id', `terminal-${i}`);
            tab.style.width = '90px';

            const text = document.createElement('span');
            text.className = 'agent-tab-text';
            text.textContent = tabLabels[i];
            tab.appendChild(text);

            wrapper.appendChild(tab);

            // Add directional shortcut hint (except for active tab)
            if (i !== activeIndex) {
                const hint = document.createElement('span');
                hint.className = 'agent-tab-shortcut-hint';
                // Tab 0 is to the left of active (index 1), so use ⌘[
                // Tabs 2 and 3 are to the right of active, so use ⌘]
                hint.textContent = i < activeIndex ? '⌘[' : '⌘]';
                wrapper.appendChild(hint);
            }

            scroll.appendChild(wrapper);
        }

        container.appendChild(scroll);
        document.body.appendChild(container);
    });

    // Wait for rendering
    await page.waitForTimeout(300);

    // Hover over the first tab (left of active) to show its ⌘[ hint
    const firstTab = page.locator('.agent-tab-wrapper').nth(0);
    await firstTab.hover();

    // Wait for hover transition
    await page.waitForTimeout(200);

    // Force the hint to be visible (in case CSS hover state isn't captured)
    await page.evaluate(() => {
        const hoveredWrapper = document.querySelectorAll('.agent-tab-wrapper')[0];
        const hint = hoveredWrapper?.querySelector('.agent-tab-shortcut-hint') as HTMLElement;
        if (hint) {
            hint.style.opacity = '1';
        }
    });

    // Take screenshot showing tabs with hover hint visible (right side of viewport)
    const viewport = page.viewportSize();
    await page.screenshot({
        path: 'e2e-tests/screenshots/agent-tabs-shortcut-hints-left.png',
        clip: { x: (viewport?.width ?? 1280) - 450, y: 0, width: 450, height: 80 }
    });

    // Now hover over the third tab (right of active) to show its ⌘] hint
    const thirdTab = page.locator('.agent-tab-wrapper').nth(2);
    await thirdTab.hover();

    // Wait for hover transition
    await page.waitForTimeout(200);

    // Force the hint to be visible
    await page.evaluate(() => {
        // Reset first hint
        const firstWrapper = document.querySelectorAll('.agent-tab-wrapper')[0];
        const firstHint = firstWrapper?.querySelector('.agent-tab-shortcut-hint') as HTMLElement;
        if (firstHint) {
            firstHint.style.opacity = '0';
        }
        // Show third hint
        const hoveredWrapper = document.querySelectorAll('.agent-tab-wrapper')[2];
        const hint = hoveredWrapper?.querySelector('.agent-tab-shortcut-hint') as HTMLElement;
        if (hint) {
            hint.style.opacity = '1';
        }
    });

    // Take screenshot showing ⌘] hint (right side of viewport)
    await page.screenshot({
        path: 'e2e-tests/screenshots/agent-tabs-shortcut-hints-right.png',
        clip: { x: (viewport?.width ?? 1280) - 450, y: 0, width: 450, height: 80 }
    });
});
