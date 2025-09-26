/// <reference types="../../../src/types/electron.d.ts" />
import { test, expect } from '@playwright/test';
import { join } from 'path';

test.describe('Graph File Picker Integration', () => {
  test('should render file picker UI correctly', async ({ page }) => {
    // Navigate to file picker test page
    await page.goto('/graph-filepicker-test.html');

    // Wait for page to load
    await page.waitForSelector('.controls', { timeout: 15000 });

    // Verify UI elements are present
    await expect(page.locator('h2')).toHaveText('File Picker Test for VoiceTree Graph');
    await expect(page.locator('#btn-single-file')).toBeVisible();
    await expect(page.locator('#btn-multiple-files')).toBeVisible();
    await expect(page.locator('#btn-directory')).toBeVisible();
    await expect(page.locator('#btn-example-data')).toBeVisible();
    await expect(page.locator('#btn-clear')).toBeVisible();
    await expect(page.locator('#drop-zone')).toBeVisible();
    await expect(page.locator('#test-file-input')).toBeHidden(); // File input should be hidden

    // Verify initial status
    const status = page.locator('#status');
    await expect(status).toHaveClass(/(info|success)/);
    await expect(status).toContainText('ready', { ignoreCase: true });
  });

  test('should load example data and render graph', async ({ page }) => {
    await page.goto('/graph-filepicker-test.html');
    await page.waitForSelector('.controls');

    // Click example data button
    await page.click('#btn-example-data');

    // Wait for graph to render
    await page.waitForSelector('#graph-container canvas', { timeout: 10000 });

    // Verify graph was created
    const nodeCount = await page.evaluate(() => {
      return window.cy ? window.cy.nodes().length : 0;
    });
    expect(nodeCount).toBe(6); // 6 files in example_small

    const edgeCount = await page.evaluate(() => {
      return window.cy ? window.cy.edges().length : 0;
    });
    expect(edgeCount).toBeGreaterThan(0);

    // Verify status shows success
    const status = page.locator('#status');
    await expect(status).toHaveClass(/success/);
    await expect(status).toContainText('rendered successfully');
  });

  test('should simulate file upload using setInputFiles', async ({ page }) => {
    await page.goto('/graph-filepicker-test.html');
    await page.waitForSelector('.controls');

    // Get paths to test markdown files
    const testDir = join(process.cwd(), 'tests', 'example_small');
    const testFiles = [
      join(testDir, '1_VoiceTree_Website_Development_and_Node_Display_Bug.md'),
      join(testDir, '2_VoiceTree_Node_ID_Duplication_Bug.md')
    ];

    // Set files on the test file input
    await page.setInputFiles('#test-file-input', testFiles);

    // Wait for processing
    await page.waitForTimeout(1000);

    // Wait for graph to render
    await page.waitForSelector('#graph-container canvas', { timeout: 10000 });

    // Verify graph was created from uploaded files
    const nodeCount = await page.evaluate(() => {
      return window.cy ? window.cy.nodes().length : 0;
    });
    expect(nodeCount).toBeGreaterThanOrEqual(2); // At least the 2 files we uploaded

    // Verify status shows success
    const status = page.locator('#status');
    await expect(status).toHaveClass(/success/);
  });

  test('should handle file loading via JavaScript API', async ({ page }) => {
    await page.goto('/graph-filepicker-test.html');
    await page.waitForSelector('.controls');

    // Use the exposed test function to simulate file loading
    await page.evaluate(() => {
      // This calls the loadTestData function exposed by file-picker-test-runner.ts
      window.loadTestData();
    });

    // Wait for graph to render
    await page.waitForSelector('#graph-container canvas', { timeout: 5000 });

    // Verify test graph was created
    const nodeCount = await page.evaluate(() => {
      return window.cy ? window.cy.nodes().length : 0;
    });
    expect(nodeCount).toBe(3); // Test data has 3 nodes

    const edgeCount = await page.evaluate(() => {
      return window.cy ? window.cy.edges().length : 0;
    });
    expect(edgeCount).toBe(2); // Test data has 2 edges

    // Verify status shows success
    const status = page.locator('#status');
    await expect(status).toHaveClass(/success/);
    await expect(status).toContainText('automation');
  });

  test('should clear graph when clear button is clicked', async ({ page }) => {
    await page.goto('/graph-filepicker-test.html');
    await page.waitForSelector('.controls');

    // First load some data
    await page.click('#btn-example-data');
    await page.waitForSelector('#graph-container canvas', { timeout: 5000 });

    // Verify data is loaded
    let nodeCount = await page.evaluate(() => {
      return window.cy ? window.cy.nodes().length : 0;
    });
    expect(nodeCount).toBeGreaterThan(0);

    // Click clear button
    await page.click('#btn-clear');

    // Wait for clearing to complete
    await page.waitForTimeout(500);

    // Verify graph was cleared
    nodeCount = await page.evaluate(() => {
      return window.cy ? window.cy.nodes().length : 0;
    });
    expect(nodeCount).toBe(0);

    // Verify status shows cleared
    const status = page.locator('#status');
    await expect(status).toContainText('cleared', { ignoreCase: true });
  });

  test('should show appropriate status messages for different actions', async ({ page }) => {
    await page.goto('/graph-filepicker-test.html');
    await page.waitForSelector('.controls');

    const status = page.locator('#status');

    // Test example data loading
    await page.click('#btn-example-data');
    await expect(status).toHaveClass(/success/);
    await expect(status).toContainText('rendered successfully');

    // Test clearing
    await page.click('#btn-clear');
    await expect(status).toHaveClass(/info/);
    await expect(status).toContainText('cleared');
  });

  test('should expose correct API for automation testing', async ({ page }) => {
    await page.goto('/graph-filepicker-test.html');
    await page.waitForSelector('.controls');

    // Load test data first
    await page.evaluate(() => window.loadTestData());
    await page.waitForSelector('#graph-container canvas');

    // Verify exposed functions and objects
    const apiCheck = await page.evaluate(() => {
      return {
        hasCy: typeof window.cy !== 'undefined',
        hasCytoscapeCore: typeof window.cytoscapeCore !== 'undefined',
        hasLayoutManager: typeof window.layoutManager !== 'undefined',
        hasLoadTestData: typeof window.loadTestData === 'function',
        hasSimulateFileLoad: typeof window.simulateFileLoad === 'function',
        cyNodeCount: window.cy ? window.cy.nodes().length : 0
      };
    });

    expect(apiCheck.hasCy).toBe(true);
    expect(apiCheck.hasCytoscapeCore).toBe(true);
    expect(apiCheck.hasLayoutManager).toBe(true);
    expect(apiCheck.hasLoadTestData).toBe(true);
    expect(apiCheck.hasSimulateFileLoad).toBe(true);
    expect(apiCheck.cyNodeCount).toBe(3);
  });
});