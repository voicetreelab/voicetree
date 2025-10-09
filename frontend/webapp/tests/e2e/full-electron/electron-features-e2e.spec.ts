import { test as base, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import {
  ExtendedWindow,
  waitForAppLoad,
  startWatching,
  pollForNodeCount,
  pollForGraphState,
  createMarkdownFile,
  rightClickFirstNode,
  getThemeState,
  checkBreathingAnimation,
  clearBreathingAnimation
} from './test-utils';
import { checkLayoutQuality } from './layout-utils';

const PROJECT_ROOT = path.resolve(process.cwd());

const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
  tempDir: string;
}>({
  electronApp: async ({}, use) => {
    const launchArgs = [path.join(PROJECT_ROOT, 'dist-electron/main/index.js')];

    // Add macOS-specific flags to prevent focus stealing when MINIMIZE_TEST is set
    if (process.env.MINIMIZE_TEST === '1' && process.platform === 'darwin') {
      launchArgs.push('--no-activate');
      launchArgs.push('--background');
    }

    const electronApp = await electron.launch({
      args: launchArgs,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1'
      }
    });
    await use(electronApp);
    await electronApp.close();
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow();
    window.on('console', msg => console.log(`BROWSER [${msg.type()}]:`, msg.text()));
    await waitForAppLoad(window);
    await use(window);
  },

  tempDir: async ({}, use) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-test-'));
    await use(dir);
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch (error) {
      console.error(`Failed to clean up temp directory: ${error}`);
    }
  }
});

test.describe('Electron Features E2E Tests', () => {
  test('should open terminal and accept input', async ({ appWindow, tempDir }) => {
    console.log('=== Testing Terminal Functionality ===');

    await appWindow.evaluate((dir) => {
      return (window as ExtendedWindow).electronAPI?.startFileWatching(dir);
    }, tempDir);

    // Wait for initial scan with timeout fallback
    await new Promise<void>(resolve => {
      appWindow.evaluate(() => {
        const w = globalThis as ExtendedWindow;
        if (w.electronAPI?.onInitialScanComplete) {
          w.electronAPI.onInitialScanComplete(() => resolve());
        }
      });
      setTimeout(resolve, 5000);
    });

    const testFile = path.join(tempDir, 'test-node.md');
    await fs.writeFile(testFile, '# Test Node\n\nFor terminal testing.');

    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        return (window as ExtendedWindow).cytoscapeInstance?.nodes().length || 0;
      });
    }, { timeout: 15000 }).toBe(1);

    await rightClickFirstNode(appWindow);
    await appWindow.waitForTimeout(500);

    const terminalOption = await appWindow.locator('text=Terminal').first();
    await expect(terminalOption).toBeVisible({ timeout: 3000 });
    await terminalOption.click();

    const terminalWindow = await appWindow.locator('.floating-window').filter({
      has: appWindow.locator('text=Terminal')
    });
    await expect(terminalWindow).toBeVisible({ timeout: 5000 });

    const terminalContent = await terminalWindow.locator('.xterm').first();
    await expect(terminalContent).toBeVisible({ timeout: 5000 });

    await terminalContent.click();
    await appWindow.waitForTimeout(1000);
    await appWindow.keyboard.type('echo Hello Terminal');
    await appWindow.keyboard.press('Enter');
    await appWindow.waitForTimeout(1000);

    const terminalText = await terminalContent.textContent();
    expect(terminalText).toContain('echo Hello Terminal');
    expect(terminalText).toContain('Hello Terminal');

    await appWindow.keyboard.type('pwd');
    await appWindow.keyboard.press('Enter');
    await appWindow.waitForTimeout(1000);

    const updatedText = await terminalContent.textContent();
    expect(updatedText).toMatch(/\/.*|C:\\.*/);

    await appWindow.keyboard.type('exit');
    await appWindow.keyboard.press('Enter');

    console.log('✓ Terminal input and output working correctly');
  });

  test('should layout 10 nodes in 3 islands with proper spacing and no overlaps', async ({ appWindow, tempDir }) => {
    console.log('=== Testing Layout with 3 Disconnected Components ===');

    await startWatching(appWindow, tempDir);

    // Island 1: 4 nodes (A -> B -> C -> D)
    await createMarkdownFile(tempDir, 'A.md', '# Node A\n\nLinks to [[B]].');
    await createMarkdownFile(tempDir, 'B.md', '# Node B\n\nLinks to [[C]].');
    await createMarkdownFile(tempDir, 'C.md', '# Node C\n\nLinks to [[D]].');
    await createMarkdownFile(tempDir, 'D.md', '# Node D\n\nFourth node.');

    // Island 2: 3 nodes (E -> F -> G)
    await createMarkdownFile(tempDir, 'E.md', '# Node E\n\nLinks to [[F]].');
    await createMarkdownFile(tempDir, 'F.md', '# Node F\n\nLinks to [[G]].');
    await createMarkdownFile(tempDir, 'G.md', '# Node G\n\nThird node.');

    // Island 3: 3 nodes (H -> I -> J)
    await createMarkdownFile(tempDir, 'H.md', '# Node H\n\nLinks to [[I]].');
    await createMarkdownFile(tempDir, 'I.md', '# Node I\n\nLinks to [[J]].');
    await createMarkdownFile(tempDir, 'J.md', '# Node J\n\nThird node.');

    await pollForNodeCount(appWindow, 10);

    const layoutQuality = await checkLayoutQuality(appWindow);

    console.log('Layout quality:', {
      nodeCount: layoutQuality.nodeCount,
      edgeCount: layoutQuality.edgeCount,
      minDistance: layoutQuality.minDistance,
      closeNodesCount: layoutQuality.closeNodes.length,
      edgeOverlapsCount: layoutQuality.edgeOverlaps.length,
      graphSpread: layoutQuality.graphSpread
    });

    expect(layoutQuality.nodeCount).toBe(10);
    expect(layoutQuality.edgeCount).toBeGreaterThanOrEqual(6);
    expect(layoutQuality.minDistance).toBeGreaterThan(50);
    expect(layoutQuality.closeNodes.length).toBe(0);
    expect(layoutQuality.edgeOverlaps.length).toBe(0);
    expect(layoutQuality.graphSpread.width).toBeGreaterThan(200);
    expect(layoutQuality.graphSpread.height).toBeGreaterThan(200);

    await appWindow.screenshot({
      path: 'tests/screenshots/electron-layout-3-islands.png',
      fullPage: true
    });

    console.log('✓ Layout with 3 islands verified successfully');
  });

  test('should animate new nodes with breathing effect and stop on hover', async ({ appWindow, tempDir }) => {
    console.log('=== Testing Breathing Animation Feature ===');

    await startWatching(appWindow, tempDir);

    console.log('=== Creating first file and checking breathing animation ===');
    await createMarkdownFile(tempDir, 'first-node.md', '# First Node\n\nFirst node.');
    await pollForNodeCount(appWindow, 1);

    // Wait a bit for animation to start
    await appWindow.waitForTimeout(500);

    const breathingCheck = await checkBreathingAnimation(appWindow);
    console.log('Breathing check results:', breathingCheck);
    expect(breathingCheck.isWidthAnimating).toBe(true);
    expect(breathingCheck.isColorAnimating).toBe(true);
    expect(breathingCheck.breathingActive).toBe(true);
    expect(breathingCheck.animationType).toBe('new_node');

    for (const sample of breathingCheck.borderWidthSamples) {
      expect(sample).toBeGreaterThan(0);
    }

    console.log('✓ Animation is breathing');

    console.log('=== Testing hover stops animation ===');
    await appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) return;
      cy.nodes().first().emit('mouseover');
    });

    // Wait for CSS transitions to complete (transition-duration is 1000ms)
    await appWindow.waitForTimeout(1200);

    const afterHoverChecks = await appWindow.evaluate(async () => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) return null;
      const node = cy.nodes().first();
      const checks = [];
      for (let i = 0; i < 3; i++) {
        checks.push({
          breathingActive: node.data('breathingActive'),
          borderWidth: node.style('border-width'),
          borderColor: node.style('border-color')
        });
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      return checks;
    });

    // After hover, breathing should be inactive
    for (const check of afterHoverChecks || []) {
      expect(check.breathingActive).toBeFalsy();
    }

    // Border should be stable (not animating) - all samples should be the same
    const borderWidths = (afterHoverChecks || []).map(c => c.borderWidth);
    const borderColors = (afterHoverChecks || []).map(c => c.borderColor);
    const widthsAllSame = borderWidths.every(w => w === borderWidths[0]);
    const colorsAllSame = borderColors.every(c => c === borderColors[0]);
    expect(widthsAllSame).toBe(true);
    expect(colorsAllSame).toBe(true);

    // The stopped border should be different from at least one of the animated states
    const finalColor = borderColors[0];
    const wasAnimatingWithDifferentColor = breathingCheck.borderColorSamples.some(c => c !== finalColor);
    expect(wasAnimatingWithDifferentColor).toBe(true);

    console.log('✓ Hover stops animation');

    console.log('=== Testing updated node breathing animation ===');
    await createMarkdownFile(tempDir, 'second-node.md', '# Second Node\n\nInitial content.');
    await pollForNodeCount(appWindow, 2);
    await appWindow.waitForTimeout(1000);

    // Clear animation
    await clearBreathingAnimation(appWindow, 'second-node');
    await appWindow.waitForTimeout(500);

    // Update file
    await fs.writeFile(
      path.join(tempDir, 'second-node.md'),
      '# Second Node\n\nInitial content.\n\n## New Section\n\nAppended!'
    );
    await appWindow.waitForTimeout(500);

    const updatedNodeBreathing = await checkBreathingAnimation(appWindow, 'second-node', 3, 500);
    expect(updatedNodeBreathing.breathingActive).toBe(true);
    expect(updatedNodeBreathing.animationType).toBe('appended_content');
    expect(updatedNodeBreathing.isWidthAnimating).toBe(true);
    expect(updatedNodeBreathing.isColorAnimating).toBe(true);

    console.log('✓ Breathing animation feature test completed');
  });

  test('should toggle dark/light mode via UI and update graph colors', async ({ appWindow, tempDir }) => {
    console.log('=== Testing Dark/Light Mode Toggle ===');

    await startWatching(appWindow, tempDir);
    await createMarkdownFile(tempDir, 'node1.md', '# Node 1\n\nLinks to [[node2]].');
    await createMarkdownFile(tempDir, 'node2.md', '# Node 2\n\nSecond node.');
    await pollForGraphState(appWindow, { nodes: 2, edges: 1 });

    console.log('=== Step 1: Check initial colors (light mode) ===');
    const initialColors = await getThemeState(appWindow);
    expect(initialColors.isDarkMode).toBe(false);
    expect(initialColors.nodeColor).toBe('rgb(42,42,42)');
    expect(initialColors.edgeColor).toBe('rgb(42,42,42)');

    console.log('=== Step 2: Click dark mode button ===');
    const darkModeButton = await appWindow.locator('[data-testid="speed-dial-item-0"]');
    await expect(darkModeButton).toBeVisible({ timeout: 3000 });
    await darkModeButton.click({ force: true });
    await appWindow.waitForTimeout(500);

    const afterDark = await getThemeState(appWindow);
    expect(afterDark.isDarkMode).toBe(true);
    expect(afterDark.nodeColor).toBe('rgb(220,221,222)');
    expect(afterDark.edgeColor).toBe('rgb(220,221,222)');

    console.log('=== Step 3: Click light mode button ===');
    await darkModeButton.click({ force: true });
    await appWindow.waitForTimeout(500);

    const afterLight = await getThemeState(appWindow);
    expect(afterLight.isDarkMode).toBe(false);
    expect(afterLight.nodeColor).toBe('rgb(42,42,42)');
    expect(afterLight.edgeColor).toBe('rgb(42,42,42)');

    console.log('✓ Dark/light mode toggle working correctly!');
  });

  // NOTE: OS preference override is tested at unit level (StyleService.test.ts:105-134)
  // E2E testing this scenario is complex due to Electron's preload timing
  // The unit test "should use dark text when app is in light mode even if OS prefers dark"
  // comprehensively covers the bug fix where app theme should override OS preference
});

export { test };
