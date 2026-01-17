/**
 * E2E tests for Image Viewer floating window
 * Tests hover and pin workflows for image nodes
 *
 * Success criteria from Phase 4: Integration Testing
 * - E2E: Hover image node, verify image viewer opens
 * - E2E: Pin image node, verify anchored viewer with shadow node
 */

import { test as base, expect } from '@playwright/test';
import {
  setupMockElectronAPI,
  sendGraphDelta,
  waitForCytoscapeReady,
  type ExtendedWindow
} from '@e2e/playwright-browser/graph-delta-test-utils';
import type { GraphDelta } from '@/pure/graph';

// Custom fixture to capture console logs and only show on failure
type ConsoleCapture = {
  consoleLogs: string[];
  pageErrors: string[];
  testLogs: string[];
};

const test = base.extend<{ consoleCapture: ConsoleCapture }>({
  consoleCapture: async ({ page }, use, testInfo) => {
    const consoleLogs: string[] = [];
    const pageErrors: string[] = [];
    const testLogs: string[] = [];

    page.on('console', msg => {
      consoleLogs.push(`[Browser ${msg.type()}] ${msg.text()}`);
    });

    page.on('pageerror', error => {
      pageErrors.push(`[Browser Error] ${error.message}\n${error.stack ?? ''}`);
    });

    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      testLogs.push(args.map(arg => String(arg)).join(' '));
    };

    await use({ consoleLogs, pageErrors, testLogs });

    console.log = originalLog;

    if (testInfo.status !== 'passed') {
      console.log('\n=== Test Logs ===');
      testLogs.forEach(log => console.log(log));
      console.log('\n=== Browser Console Logs ===');
      consoleLogs.forEach(log => console.log(log));
      if (pageErrors.length > 0) {
        console.log('\n=== Browser Errors ===');
        pageErrors.forEach(err => console.log(err));
      }
    }
  }
});

test.describe('Image Viewer Floating Window', () => {

  test.describe('Hover Image Node', () => {
    test('should open image viewer when hovering over image node', async ({ page, consoleCapture: _consoleCapture }) => {
      console.log('\n=== Starting hover image node test ===');

      await setupMockElectronAPI(page);
      await page.goto('/');
      await page.waitForSelector('#root', { timeout: 5000 });
      await page.waitForTimeout(50);
      await waitForCytoscapeReady(page);

      // Create an image node (PNG file)
      const graphDelta: GraphDelta = [
        {
          type: 'UpsertNode' as const,
          nodeToUpsert: {
            absoluteFilePathIsID: 'test-image.png',
            contentWithoutYamlOrLinks: '', // Image nodes have empty content
            outgoingEdges: [],
            nodeUIMetadata: {
              color: { _tag: 'None' } as const,
              position: { _tag: 'Some', value: { x: 400, y: 300 } } as const,
              additionalYAMLProps: new Map(),
              isContextNode: false
            }
          },
          previousNode: { _tag: 'None' } as const
        }
      ];
      await sendGraphDelta(page, graphDelta);
      await page.waitForTimeout(50);
      console.log('OK Graph delta sent with image node');

      // Verify node exists in graph
      const nodeExists = await page.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return false;
        return cy.$('#test-image.png').length > 0;
      });
      expect(nodeExists).toBe(true);
      console.log('OK Image node exists in graph');

      // Trigger mouseover on the image node
      console.log('=== Triggering mouseover on image node ===');
      await page.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('Cytoscape not initialized');
        const node = cy.$('#test-image.png');
        if (node.length === 0) throw new Error('test-image.png not found');
        node.trigger('mouseover');
      });
      await page.waitForTimeout(300);

      // Wait for image viewer to appear (ID format: window-{nodeId}-image-viewer)
      // Note: The actual window ID escapes dots in the nodeId
      const imageViewerSelector = '[id*="test-image"][id*="image-viewer"]';
      await page.waitForSelector(imageViewerSelector, { timeout: 3000 });
      console.log('OK Image viewer appeared');

      // Verify it's an image viewer (contains img element), not an editor (contains CodeMirror)
      const viewerInfo = await page.evaluate((selector: string) => {
        const viewerWindow = document.querySelector(selector);
        if (!viewerWindow) return { found: false, hasImage: false, hasCodeMirror: false, hasShadowNode: false };

        // Check for img element (image viewer)
        const hasImage = viewerWindow.querySelector('img') !== null;
        // Check for CodeMirror (editor)
        const hasCodeMirror = viewerWindow.querySelector('.cm-editor') !== null;

        // Check there's no shadow node (hover mode)
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        const hasShadowNode = cy ? cy.$('#test-image\\.png-image-viewer-anchor-shadowNode').length > 0 : false;

        return { found: true, hasImage, hasCodeMirror, hasShadowNode };
      }, imageViewerSelector);

      expect(viewerInfo.found).toBe(true);
      expect(viewerInfo.hasImage).toBe(true);
      expect(viewerInfo.hasCodeMirror).toBe(false);
      expect(viewerInfo.hasShadowNode).toBe(false);
      console.log('OK Image viewer contains img element, not CodeMirror (editor)');
      console.log('OK No shadow node (hover mode)');

      // Take screenshot
      await page.screenshot({ path: 'e2e-tests/screenshots/image-viewer-hover.png', fullPage: true });
      console.log('OK Screenshot taken');

      console.log('OK Hover image node test completed');
    });

    test('should NOT open editor for image node', async ({ page, consoleCapture: _consoleCapture }) => {
      console.log('\n=== Starting image node should not open editor test ===');

      await setupMockElectronAPI(page);
      await page.goto('/');
      await page.waitForSelector('#root', { timeout: 5000 });
      await page.waitForTimeout(50);
      await waitForCytoscapeReady(page);

      // Create an image node
      const graphDelta: GraphDelta = [
        {
          type: 'UpsertNode' as const,
          nodeToUpsert: {
            absoluteFilePathIsID: 'photo.jpg',
            contentWithoutYamlOrLinks: '',
            outgoingEdges: [],
            nodeUIMetadata: {
              color: { _tag: 'None' } as const,
              position: { _tag: 'Some', value: { x: 400, y: 300 } } as const,
              additionalYAMLProps: new Map(),
              isContextNode: false
            }
          },
          previousNode: { _tag: 'None' } as const
        }
      ];
      await sendGraphDelta(page, graphDelta);
      await page.waitForTimeout(50);

      // Trigger mouseover
      await page.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('Cytoscape not initialized');
        const node = cy.$('#photo.jpg');
        if (node.length === 0) throw new Error('photo.jpg not found');
        node.trigger('mouseover');
      });
      await page.waitForTimeout(300);

      // Verify NO editor opened (no #window-*-editor element)
      const editorExists = await page.evaluate(() => {
        const editorWindow = document.querySelector('[id*="photo"][id*="editor"]');
        return editorWindow !== null;
      });
      expect(editorExists).toBe(false);
      console.log('OK No editor opened for image node');

      console.log('OK Image node should not open editor test completed');
    });
  });

  test.describe('Pin Image Node', () => {
    test('should create anchored image viewer with shadow node when pin button is clicked', async ({ page, consoleCapture: _consoleCapture }) => {
      console.log('\n=== Starting pin image node test ===');

      await setupMockElectronAPI(page);
      await page.goto('/');
      await page.waitForSelector('#root', { timeout: 5000 });
      await page.waitForTimeout(50);
      await waitForCytoscapeReady(page);

      // Create an image node
      const graphDelta: GraphDelta = [
        {
          type: 'UpsertNode' as const,
          nodeToUpsert: {
            absoluteFilePathIsID: 'screenshot.png',
            contentWithoutYamlOrLinks: '',
            outgoingEdges: [],
            nodeUIMetadata: {
              color: { _tag: 'None' } as const,
              position: { _tag: 'Some', value: { x: 400, y: 400 } } as const,
              additionalYAMLProps: new Map(),
              isContextNode: false
            }
          },
          previousNode: { _tag: 'None' } as const
        }
      ];
      await sendGraphDelta(page, graphDelta);
      await page.waitForTimeout(50);
      console.log('OK Graph delta sent with image node');

      // Open hover image viewer by triggering mouseover
      console.log('=== Opening hover image viewer via mouseover ===');
      await page.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('Cytoscape not initialized');
        const node = cy.$('#screenshot.png');
        if (node.length === 0) throw new Error('screenshot.png not found');
        node.trigger('mouseover');
      });
      await page.waitForTimeout(300);

      // Wait for image viewer to appear
      const imageViewerSelector = '[id*="screenshot"][id*="image-viewer"]';
      await page.waitForSelector(imageViewerSelector, { timeout: 3000 });
      console.log('OK Hover image viewer appeared');

      // Verify no shadow node exists yet (hover mode)
      const shadowNodeExistsBefore = await page.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return false;
        return cy.$('#screenshot\\.png-image-viewer-anchor-shadowNode').length > 0;
      });
      expect(shadowNodeExistsBefore).toBe(false);
      console.log('OK No shadow node before pinning (hover mode)');

      // Wait for hover menu to appear
      const hoverMenuSelector = '.cy-horizontal-context-menu';
      await page.waitForSelector(hoverMenuSelector, { timeout: 3000 });
      console.log('OK Hover menu appeared');

      // Find and click the pin button
      console.log('=== Clicking pin button in hover menu ===');
      const pinButtonSelector = '.cy-horizontal-context-menu .traffic-light-pin';
      const pinButton = page.locator(pinButtonSelector);
      await expect(pinButton).toBeVisible();
      await pinButton.click();
      console.log('OK Pin button clicked');
      await page.waitForTimeout(300);

      // Verify shadow node now exists (anchored mode)
      const shadowNodeExistsAfter = await page.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return false;
        return cy.$('#screenshot\\.png-image-viewer-anchor-shadowNode').length > 0;
      });
      expect(shadowNodeExistsAfter).toBe(true);
      console.log('OK Shadow node created after pinning');

      // Verify image viewer still exists and has img element
      const viewerStillExists = await page.evaluate((selector: string) => {
        const viewerWindow = document.querySelector(selector);
        if (!viewerWindow) return { exists: false, hasImage: false };
        return {
          exists: true,
          hasImage: viewerWindow.querySelector('img') !== null
        };
      }, imageViewerSelector);

      expect(viewerStillExists.exists).toBe(true);
      expect(viewerStillExists.hasImage).toBe(true);
      console.log('OK Image viewer still exists with img element');

      // Take screenshot
      await page.screenshot({ path: 'e2e-tests/screenshots/image-viewer-pinned.png', fullPage: true });
      console.log('OK Screenshot taken');

      console.log('OK Pin image node test completed');
    });
  });

  test.describe('Image Extensions', () => {
    test.describe('should recognize various image extensions', () => {
      const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];

      for (const ext of imageExtensions) {
        test(`should open image viewer for .${ext} file`, async ({ page, consoleCapture: _consoleCapture }) => {
          await setupMockElectronAPI(page);
          await page.goto('/');
          await page.waitForSelector('#root', { timeout: 5000 });
          await page.waitForTimeout(50);
          await waitForCytoscapeReady(page);

          const nodeId = `test-file.${ext}`;
          const graphDelta: GraphDelta = [
            {
              type: 'UpsertNode' as const,
              nodeToUpsert: {
                absoluteFilePathIsID: nodeId,
                contentWithoutYamlOrLinks: '',
                outgoingEdges: [],
                nodeUIMetadata: {
                  color: { _tag: 'None' } as const,
                  position: { _tag: 'Some', value: { x: 400, y: 300 } } as const,
                  additionalYAMLProps: new Map(),
                  isContextNode: false
                }
              },
              previousNode: { _tag: 'None' } as const
            }
          ];
          await sendGraphDelta(page, graphDelta);
          await page.waitForTimeout(50);

          // Trigger mouseover
          await page.evaluate((id) => {
            const cy = (window as ExtendedWindow).cytoscapeInstance;
            if (!cy) throw new Error('Cytoscape not initialized');
            const node = cy.$(`#${id}`);
            if (node.length === 0) throw new Error(`${id} not found`);
            node.trigger('mouseover');
          }, nodeId);
          await page.waitForTimeout(300);

          // Verify image viewer opened (has img element)
          const hasImageViewer = await page.evaluate(() => {
            const viewers = document.querySelectorAll('[id*="image-viewer"]');
            for (const viewer of viewers) {
              if (viewer.querySelector('img')) return true;
            }
            return false;
          });

          expect(hasImageViewer).toBe(true);
        });
      }
    });
  });

  test.describe('Markdown Node vs Image Node', () => {
    test('should open editor for .md file and image viewer for .png file', async ({ page, consoleCapture: _consoleCapture }) => {
      console.log('\n=== Starting markdown vs image test ===');

      await setupMockElectronAPI(page);
      await page.goto('/');
      await page.waitForSelector('#root', { timeout: 5000 });
      await page.waitForTimeout(50);
      await waitForCytoscapeReady(page);

      // Create both markdown and image nodes
      const graphDelta: GraphDelta = [
        {
          type: 'UpsertNode' as const,
          nodeToUpsert: {
            absoluteFilePathIsID: 'readme.md',
            contentWithoutYamlOrLinks: '# Test Markdown\nThis is a test.',
            outgoingEdges: [],
            nodeUIMetadata: {
              color: { _tag: 'None' } as const,
              position: { _tag: 'Some', value: { x: 300, y: 300 } } as const,
              additionalYAMLProps: new Map(),
              isContextNode: false
            }
          },
          previousNode: { _tag: 'None' } as const
        },
        {
          type: 'UpsertNode' as const,
          nodeToUpsert: {
            absoluteFilePathIsID: 'diagram.png',
            contentWithoutYamlOrLinks: '',
            outgoingEdges: [],
            nodeUIMetadata: {
              color: { _tag: 'None' } as const,
              position: { _tag: 'Some', value: { x: 500, y: 300 } } as const,
              additionalYAMLProps: new Map(),
              isContextNode: false
            }
          },
          previousNode: { _tag: 'None' } as const
        }
      ];
      await sendGraphDelta(page, graphDelta);
      await page.waitForTimeout(50);
      console.log('OK Both markdown and image nodes created');

      // Hover over markdown node
      console.log('=== Hovering over markdown node ===');
      await page.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('Cytoscape not initialized');
        const node = cy.$('#readme.md');
        if (node.length === 0) throw new Error('readme.md not found');
        node.trigger('mouseover');
      });
      await page.waitForTimeout(300);

      // Verify editor opened for markdown (has CodeMirror)
      const mdHasEditor = await page.evaluate(() => {
        const editors = document.querySelectorAll('[id*="readme"][id*="editor"]');
        for (const editor of editors) {
          if (editor.querySelector('.cm-editor')) return true;
        }
        return false;
      });
      expect(mdHasEditor).toBe(true);
      console.log('OK Markdown node opened editor');

      // Move mouse away to close hover editor
      await page.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('Cytoscape not initialized');
        const node = cy.$('#readme.md');
        node.trigger('mouseout');
      });
      await page.waitForTimeout(200);

      // Hover over image node
      console.log('=== Hovering over image node ===');
      await page.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('Cytoscape not initialized');
        const node = cy.$('#diagram.png');
        if (node.length === 0) throw new Error('diagram.png not found');
        node.trigger('mouseover');
      });
      await page.waitForTimeout(300);

      // Verify image viewer opened for image (has img element, no CodeMirror)
      const imgHasViewer = await page.evaluate(() => {
        const viewers = document.querySelectorAll('[id*="diagram"][id*="image-viewer"]');
        for (const viewer of viewers) {
          if (viewer.querySelector('img') && !viewer.querySelector('.cm-editor')) return true;
        }
        return false;
      });
      expect(imgHasViewer).toBe(true);
      console.log('OK Image node opened image viewer');

      console.log('OK Markdown vs image test completed');
    });
  });
});
