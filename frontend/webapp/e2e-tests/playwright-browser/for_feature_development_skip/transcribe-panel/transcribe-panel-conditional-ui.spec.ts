/**
 * E2E test for transcription panel conditional UI elements
 * Tests that blur background and collapse arrow only appear when there is text in the transcription panel
 */

import { test as base, expect } from '@playwright/test';
import {
  setupMockElectronAPI,
  waitForCytoscapeReady,
  sendGraphDelta,
  createTestGraphDelta,
} from '@e2e/playwright-browser/graph-delta-test-utils';

const test = base.extend({});

test.describe('Transcription Panel Conditional UI Elements', () => {
  test('should only show blur and collapse arrow when text is present', async ({ page }) => {
    console.log('\n=== Starting transcription panel conditional UI test ===');

    // Setup mock Electron API (uses shared test utilities)
    await setupMockElectronAPI(page);

    // Navigate to app and wait for React to render
    await page.goto('/');
    // Wait for React app to mount by checking for content inside #root
    await page.waitForSelector('#root > *', { timeout: 10000 });
    await page.waitForTimeout(200);

    // Wait for Cytoscape to be ready (indicates app is fully loaded)
    await waitForCytoscapeReady(page);

    // Add test nodes for minimap
    await sendGraphDelta(page, createTestGraphDelta());
    await page.waitForTimeout(200);

    // Wait for the transcribe panel to be rendered
    await page.waitForSelector('.flex.flex-col.relative', { timeout: 5000 });

    // Locators for conditional UI elements
    // Note: React inline styles use camelCase but DOM uses kebab-case (backdrop-filter)
    const blurLayer = page.locator('div[style*="backdrop-filter"]').first();
    const collapseButton = page.locator('button[title="Collapse transcription"]');
    const expandButton = page.locator('button[title="Expand transcription"]');

    // === TEST 1: Empty state - no blur layer, no collapse arrow ===
    console.log('=== Verifying empty state (no text) ===');
    await expect(blurLayer).not.toBeVisible();
    await expect(collapseButton).not.toBeVisible();
    await expect(expandButton).not.toBeVisible();
    console.log('✓ Empty state: no blur layer, no collapse arrow');

    // Screenshot: Empty state
    await page.screenshot({
      path: 'e2e-tests/screenshots/transcribe-panel-empty-state.png',
    });
    console.log('✓ Screenshot: transcribe-panel-empty-state.png');

    // === TEST 2: Add text via TranscriptionStore ===
    console.log('=== Adding text to transcription store ===');
    const storeResult = await page.evaluate(() => {
      // TranscriptionStore exposes appendManualText on window.__TRANSCRIPTION_STORE__
      interface TranscriptionStoreAPI {
        appendManualText: (text: string) => void;
        reset: () => void;
        getDisplayTokenCount: () => number;
      }
      const store = (window as Window & { __TRANSCRIPTION_STORE__?: TranscriptionStoreAPI }).__TRANSCRIPTION_STORE__;
      if (store) {
        store.appendManualText('Test transcription text for visual verification');
        const count = store.getDisplayTokenCount();
        return { success: true, tokenCount: count };
      } else {
        return { success: false, error: 'TranscriptionStore not exposed on window' };
      }
    });
    console.log('Store result:', storeResult);

    // Wait for React to update
    await page.waitForTimeout(500);

    // === TEST 3: With text - blur layer AND collapse arrow should be visible ===
    console.log('=== Verifying state with text ===');
    await expect(blurLayer).toBeVisible();
    await expect(collapseButton).toBeVisible();
    console.log('✓ With text: blur layer and collapse arrow visible');

    // Screenshot: With text (blur visible)
    await page.screenshot({
      path: 'e2e-tests/screenshots/transcribe-panel-with-text-blur-visible.png',
    });
    console.log('✓ Screenshot: transcribe-panel-with-text-blur-visible.png');

    // === TEST 4: Collapse panel - arrow should rotate ===
    console.log('=== Collapsing panel ===');
    await collapseButton.click();
    await page.waitForTimeout(250); // Wait for animation

    // After collapse, expand button should be visible (arrow rotated)
    await expect(expandButton).toBeVisible();
    console.log('✓ Panel collapsed, expand button visible');

    // Screenshot: Collapsed state
    await page.screenshot({
      path: 'e2e-tests/screenshots/transcribe-panel-collapsed-with-text.png',
    });
    console.log('✓ Screenshot: transcribe-panel-collapsed-with-text.png');

    // === TEST 5: Expand again to verify toggle works ===
    console.log('=== Expanding panel again ===');
    await expandButton.click();
    await page.waitForTimeout(250);
    await expect(collapseButton).toBeVisible();
    console.log('✓ Panel expanded again');

    console.log('\n✅ Transcription panel conditional UI test PASSED!');
  });
});
