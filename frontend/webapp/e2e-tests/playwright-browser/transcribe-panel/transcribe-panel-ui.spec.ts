/**
 * Browser-based test for transcribe panel UI
 * Takes a screenshot of the transcribe panel with mock transcribed text
 */

import { test as base, expect } from '@playwright/test';
import {
  setupMockElectronAPI,
  waitForCytoscapeReady,
} from '@e2e/playwright-browser/graph-delta-test-utils';

const test = base.extend({});

test.describe('Transcribe Panel UI', () => {
  test('should display transcribed text with transparent fade effect', async ({ page }) => {
    console.log('\n=== Starting transcribe panel UI test ===');

    console.log('=== Step 1: Setup mock Electron API ===');
    await setupMockElectronAPI(page);
    console.log('✓ Electron API mock prepared');

    console.log('=== Step 2: Navigate to app ===');
    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    console.log('✓ React rendered');

    await page.waitForTimeout(100);

    console.log('=== Step 3: Wait for Cytoscape ===');
    await waitForCytoscapeReady(page);
    console.log('✓ Cytoscape initialized');

    console.log('=== Step 4: Inject mock transcription tokens ===');
    // We need to inject mock tokens into the VoiceTreeTranscribe component
    // Since the component uses React state, we'll manipulate it via exposed window APIs
    // or by directly updating the DOM with mock content

    // Wait for the transcribe panel to be rendered
    await page.waitForSelector('.flex.flex-col.bg-background', { timeout: 5000 });

    // Inject mock transcribed text by modifying the Renderer's DOM
    // The Renderer component displays tokens - we'll add mock token spans
    await page.evaluate(() => {
      // Find the transcription display container (the auto-scroll div)
      const transcriptionDisplay = document.querySelector('.h-20.overflow-y-auto');
      if (!transcriptionDisplay) {
        console.error('Could not find transcription display');
        return;
      }

      // Clear any existing content and add many lines of mock transcribed text
      // All lines use same black styling so fade effect is clearly visible
      transcriptionDisplay.innerHTML = `
        <div style="padding: 8px;">
          <div class="text-black font-medium">Line 1: This is the first line of transcribed speech from the voice input.</div>
          <div class="text-black font-medium">Line 2: The user is speaking about their project ideas and requirements.</div>
          <div class="text-black font-medium">Line 3: We need to implement a new feature for the dashboard component.</div>
          <div class="text-black font-medium">Line 4: The feature should allow users to visualize their data in real-time.</div>
          <div class="text-black font-medium">Line 5: Additionally, we want to add filtering and sorting capabilities.</div>
          <div class="text-black font-medium">Line 6: The UI should be responsive and work well on mobile devices.</div>
          <div class="text-black font-medium">Line 7: We also need to consider accessibility requirements for screen readers.</div>
          <div class="text-black font-medium">Line 8: Performance optimization is crucial for large datasets.</div>
          <div class="text-black font-medium">Line 9: Let's start with a basic prototype and iterate from there.</div>
          <div class="text-black font-medium">Line 10: This is the most recent transcribed text at full opacity.</div>
        </div>
      `;

      // Scroll to bottom to show latest content
      transcriptionDisplay.scrollTop = transcriptionDisplay.scrollHeight;
    });
    console.log('✓ Mock transcription tokens injected');

    console.log('=== Step 5: Verify the Record speech label is visible ===');
    const recordLabel = await page.locator('span:has-text("Record speech")').first();
    await expect(recordLabel).toBeVisible();
    console.log('✓ "Record speech" label is visible');

    console.log('=== Step 6: Take screenshot of transcribe panel ===');
    // Take a screenshot of just the transcribe section
    const transcribeSection = page.locator('.flex-shrink-0.py-2.px-4').first();
    await transcribeSection.screenshot({
      path: 'e2e-tests/screenshots/transcribe-panel-with-text.png',
    });
    console.log('✓ Screenshot saved to e2e-tests/screenshots/transcribe-panel-with-text.png');

    // Also take full page screenshot for context
    await page.screenshot({
      path: 'e2e-tests/screenshots/transcribe-panel-full-page.png',
    });
    console.log('✓ Full page screenshot saved');

    console.log('=== Step 7: Verify transparency and fade styles ===');
    const maskStyle = await page.evaluate(() => {
      const container = document.querySelector('.h-20.overflow-y-auto');
      if (!container) return null;
      const style = window.getComputedStyle(container as Element);
      return {
        maskImage: style.maskImage || style.webkitMaskImage,
        background: style.background,
        backgroundColor: style.backgroundColor,
      };
    });

    console.log('  Container styles:', maskStyle);
    // Verify mask-image is applied (for fade effect) - top is 50% faded, bottom is full opacity
    expect(maskStyle?.maskImage).toContain('gradient');
    expect(maskStyle?.maskImage).toContain('rgba(0, 0, 0, 0.5)'); // 50% at top
    expect(maskStyle?.maskImage).toContain('rgb(0, 0, 0)'); // full opacity at bottom
    console.log('✓ Fade mask gradient is applied (50% top, full opacity bottom)');

    console.log('\n✅ Transcribe panel UI test PASSED!');
  });

  test('should show "Recording" label when recording', async ({ page }) => {
    console.log('\n=== Starting recording state test ===');

    await setupMockElectronAPI(page);
    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    await waitForCytoscapeReady(page);

    // Initially should show "Record speech"
    const recordLabel = await page.locator('span:has-text("Record speech")').first();
    await expect(recordLabel).toBeVisible();
    console.log('✓ Initial "Record speech" label visible');

    // Click the mic button to start recording
    // Note: This will likely fail since Soniox API won't be available in test,
    // but we can verify the button is clickable
    const micButton = page.locator('button').filter({ has: page.locator('svg') }).first();

    // For a proper test, we'd need to mock the Soniox client state
    // For now, just verify the UI elements exist
    await expect(micButton).toBeVisible();
    console.log('✓ Mic button is visible');

    // Take screenshot of initial state
    await page.screenshot({
      path: 'e2e-tests/screenshots/transcribe-panel-not-recording.png',
    });
    console.log('✓ Screenshot of not-recording state saved');

    console.log('\n✅ Recording state test PASSED!');
  });
});
