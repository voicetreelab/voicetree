/**
 * Screenshot test for transcription preview chip text wrapping
 * Verifies that long text wraps instead of being truncated with ellipsis
 *
 * This is a CSS-focused test that creates a minimal HTML page with just the
 * required styles to verify the wrapping behavior.
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// Read the CSS file content
const cssFilePath = path.join(
  process.cwd(),
  'src/shell/UI/cytoscape-graph-ui/styles/floating-windows.css'
);

test.describe('Transcription Preview Chip Text Wrapping', () => {
  test('long text should wrap vertically instead of truncating', async ({ page }) => {
    console.log('\n=== Starting preview chip text wrap screenshot test ===');

    // Read CSS file
    const cssContent = fs.readFileSync(cssFilePath, 'utf-8');

    // Create minimal HTML page with just the CSS and test elements
    const longText = 'This is a very long transcription text that should wrap to multiple lines instead of being truncated with an ellipsis. The text continues with more content to ensure we can see the wrapping behavior clearly in the screenshot.';

    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          :root {
            --card: #ffffff;
            --border: #e5e7eb;
            --foreground: #1f2937;
            --muted-foreground: #6b7280;
          }
          body {
            background: #f3f4f6;
            padding: 50px;
            font-family: system-ui, -apple-system, sans-serif;
          }
          ${cssContent}
        </style>
      </head>
      <body>
        <div class="transcription-preview-chip" style="position: relative; left: auto; top: auto; transform: none;">
          <span class="preview-text">${longText}</span>
          <span class="preview-hints">↵ · Esc</span>
        </div>
      </body>
      </html>
    `);

    await page.waitForTimeout(100);

    // Verify the chip is visible
    await expect(page.locator('.transcription-preview-chip')).toBeVisible();
    console.log('Preview chip visible');

    // Take screenshot of the chip
    const chip = page.locator('.transcription-preview-chip');
    await chip.screenshot({
      path: 'e2e-tests/screenshots/preview-chip-text-wrap.png'
    });
    console.log('Chip screenshot saved to e2e-tests/screenshots/preview-chip-text-wrap.png');

    // Verify text is not truncated (no ellipsis)
    const textContent = await page.evaluate(() => {
      const textSpan = document.querySelector('.transcription-preview-chip .preview-text');
      if (!textSpan) return { text: '', hasEllipsis: false, whiteSpace: '', height: 0 };

      const style = window.getComputedStyle(textSpan);
      return {
        text: textSpan.textContent,
        hasEllipsis: style.textOverflow === 'ellipsis',
        whiteSpace: style.whiteSpace,
        height: textSpan.getBoundingClientRect().height
      };
    });

    console.log('Text properties:', textContent);

    // The text should NOT have ellipsis truncation
    expect(textContent.hasEllipsis).toBe(false);

    // white-space should allow wrapping (not 'nowrap')
    expect(textContent.whiteSpace).not.toBe('nowrap');

    // Height should be greater than single line (~20px) indicating wrapping occurred
    expect(textContent.height).toBeGreaterThan(30);
    console.log(`Text height: ${textContent.height}px (multi-line wrapping confirmed)`);

    // Take full page screenshot for context
    await page.screenshot({
      path: 'e2e-tests/screenshots/preview-chip-text-wrap-full-page.png'
    });
    console.log('Full page screenshot saved');

    console.log('Preview chip text wrap test completed successfully');
  });

  test('short text should display normally', async ({ page }) => {
    console.log('\n=== Starting preview chip short text test ===');

    const cssContent = fs.readFileSync(cssFilePath, 'utf-8');
    const shortText = 'Short transcription text';

    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          :root {
            --card: #ffffff;
            --border: #e5e7eb;
            --foreground: #1f2937;
            --muted-foreground: #6b7280;
          }
          body {
            background: #f3f4f6;
            padding: 50px;
            font-family: system-ui, -apple-system, sans-serif;
          }
          ${cssContent}
        </style>
      </head>
      <body>
        <div class="transcription-preview-chip" style="position: relative; left: auto; top: auto; transform: none;">
          <span class="preview-text">${shortText}</span>
          <span class="preview-hints">↵ · Esc</span>
        </div>
      </body>
      </html>
    `);

    await page.waitForTimeout(100);

    await expect(page.locator('.transcription-preview-chip')).toBeVisible();

    // Take screenshot of short text chip
    const chip = page.locator('.transcription-preview-chip');
    await chip.screenshot({
      path: 'e2e-tests/screenshots/preview-chip-short-text.png'
    });
    console.log('Short text chip screenshot saved');

    // Verify the text is displayed correctly
    const textContent = await page.evaluate(() => {
      const textSpan = document.querySelector('.transcription-preview-chip .preview-text');
      return textSpan?.textContent ?? '';
    });

    expect(textContent).toBe(shortText);
    console.log('Short text displayed correctly');
  });
});
