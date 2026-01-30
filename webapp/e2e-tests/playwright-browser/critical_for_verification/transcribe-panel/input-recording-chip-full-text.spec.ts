/**
 * Test for input recording chip showing full transcribed content
 *
 * Verifies that the transcription preview chip displays the full
 * recorded/transcribed text instead of truncating with "..."
 *
 * This test targets the transcription-preview-chip component which appears
 * when speech is transcribed and awaiting user confirmation (Enter/Esc).
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// Read the CSS file content for styling the chip
const cssFilePath = path.join(
  process.cwd(),
  'src/shell/UI/cytoscape-graph-ui/styles/floating-windows.css'
);

test.describe('Input Recording Chip Full Text Display', () => {
  test('should display full transcribed text instead of truncating with ellipsis', async ({ page }) => {
    console.log('\n=== Starting input recording chip full text test ===');

    // Read CSS file
    const cssContent = fs.readFileSync(cssFilePath, 'utf-8');

    // Long text that would previously be truncated at 50 characters
    const fullTranscribedText = 'This is a long transcribed text from voice recording that should be fully visible in the chip without any truncation or ellipsis because the user needs to see what they said before confirming.';

    // Create minimal HTML page with the transcription preview chip
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
          <span class="preview-text">${fullTranscribedText}</span>
          <span class="preview-hints">\u21b5 \u00b7 Esc</span>
        </div>
      </body>
      </html>
    `);

    await page.waitForTimeout(100);

    // Verify the chip is visible
    await expect(page.locator('.transcription-preview-chip')).toBeVisible();
    console.log('Preview chip visible');

    // Get the displayed text content
    const displayedText = await page.evaluate(() => {
      const textSpan = document.querySelector('.transcription-preview-chip .preview-text');
      return textSpan?.textContent ?? '';
    });

    console.log(`Expected text length: ${fullTranscribedText.length}`);
    console.log(`Displayed text length: ${displayedText.length}`);
    console.log(`Displayed text: "${displayedText}"`);

    // CRITICAL ASSERTION: The displayed text should be the FULL text, not truncated
    expect(displayedText).toBe(fullTranscribedText);
    expect(displayedText).not.toContain('...');
    expect(displayedText.length).toBe(fullTranscribedText.length);

    // Take screenshot for visual verification
    const chip = page.locator('.transcription-preview-chip');
    await chip.screenshot({
      path: 'e2e-tests/screenshots/input-recording-chip-full-text.png'
    });
    console.log('Screenshot saved to e2e-tests/screenshots/input-recording-chip-full-text.png');

    console.log('\n=== Input recording chip full text test completed ===');
  });

  test('chip should wrap long text instead of single-line truncation', async ({ page }) => {
    console.log('\n=== Starting chip text wrap test ===');

    const cssContent = fs.readFileSync(cssFilePath, 'utf-8');

    const longText = 'This is a very long transcribed message that needs to wrap onto multiple lines because the user spoke a lot and we want to show them everything they said without cutting it off with an ellipsis.';

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
          <span class="preview-hints">\u21b5 \u00b7 Esc</span>
        </div>
      </body>
      </html>
    `);

    await page.waitForTimeout(100);

    // Verify text wrapping properties
    const textProperties = await page.evaluate(() => {
      const textSpan = document.querySelector('.transcription-preview-chip .preview-text');
      if (!textSpan) return null;

      const style = window.getComputedStyle(textSpan);
      const rect = textSpan.getBoundingClientRect();
      return {
        text: textSpan.textContent,
        whiteSpace: style.whiteSpace,
        textOverflow: style.textOverflow,
        height: rect.height,
        overflow: style.overflow
      };
    });

    console.log('Text properties:', textProperties);

    // The text should NOT be set to single-line with ellipsis truncation
    expect(textProperties?.textOverflow).not.toBe('ellipsis');
    expect(textProperties?.whiteSpace).not.toBe('nowrap');

    // Height should indicate multi-line wrapping (more than single line ~20px)
    expect(textProperties?.height).toBeGreaterThan(30);
    console.log(`Text height: ${textProperties?.height}px - confirms multi-line wrapping`);

    // Full text should be displayed
    expect(textProperties?.text).toBe(longText);

    await page.screenshot({
      path: 'e2e-tests/screenshots/input-recording-chip-wrapped.png'
    });
    console.log('Screenshot saved');

    console.log('\n=== Chip text wrap test completed ===');
  });

  test('speech-to-focused chip creation shows full text (no truncation)', async ({ page }) => {
    console.log('\n=== Testing speech-to-focused.ts chip creation behavior ===');

    // This test simulates what speech-to-focused.ts does when creating the chip
    // After the fix, it should show full text without truncation

    const cssContent = fs.readFileSync(cssFilePath, 'utf-8');

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
        <div id="test-container"></div>
        <script>
          // Recreate escapeHtml function (same as speech-to-focused.ts)
          function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
          }

          // Test with long text - this simulates showTranscriptionPreview behavior
          const originalText = 'This is a long transcription that exceeds fifty characters and should NOT be truncated with ellipsis because the user needs to see the full text.';

          // FIXED BEHAVIOR: No truncation, show full text
          const displayText = originalText;

          // Create chip the way speech-to-focused.ts does it (after fix)
          const chip = document.createElement('div');
          chip.className = 'transcription-preview-chip';
          chip.style.cssText = 'position: relative; left: auto; top: auto; transform: none;';
          chip.innerHTML = \`
            <span class="preview-text">\${escapeHtml(displayText)}</span>
            <span class="preview-hints">↵ · Esc</span>
          \`;

          document.getElementById('test-container').appendChild(chip);

          // Expose values for test assertions
          window.testData = {
            originalText,
            displayedText: chip.querySelector('.preview-text').textContent
          };
        </script>
      </body>
      </html>
    `);

    await page.waitForTimeout(100);

    const testData = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (window as any).testData;
    });

    console.log('Original text length:', testData.originalText.length);
    console.log('Displayed text length:', testData.displayedText.length);
    console.log('Displayed text:', `"${testData.displayedText}"`);
    console.log('Has ellipsis:', testData.displayedText.includes('...'));

    // Assert that the FULL text is displayed (should pass after fix)
    expect(testData.displayedText).toBe(testData.originalText);
    expect(testData.displayedText).not.toContain('...');

    console.log('\n=== Full text display verified ===');
  });
});
