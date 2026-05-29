/**
 * BEHAVIORAL SPEC: Markdown Editor CRUD Operations (renderer-driven save path)
 *
 * 1. Clicking nodes opens floating markdown editors that save changes to disk
 *    (incl. subfolders).
 * 2. Real keyboard input through CodeMirror produces an exact on-disk file.
 *
 * External-source sync (filesystem-watcher → editor) and wikilink → graph
 * regressions live in `electron-markdown-editor-external-sync.spec.ts`.
 *
 * Editor reads go through the production `vanillaFloatingWindowInstances`
 * store via `window.__vtDebug__.editorInstance(id)`. The older path of
 * reading CodeMirror's internal `.cmView` property stopped working when
 * @codemirror/view 6.43 renamed that DOM property to `.cmTile`.
 *
 * IMPORTANT: THESE SPEC COMMENTS MUST BE KEPT UP TO DATE
 */

import { expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import type { ExtendedWindow } from './helpers/electron-markdown-editor-fixtures';
import {
  FIXTURE_PROJECT_PATH,
  expectFrontmatterShapePreserved,
  registerStopFileWatchingAfterEach,
  test,
} from './helpers/electron-markdown-editor-fixtures';
import {
  focusEditorInstance,
  getEditorInstanceId,
  readEditorValue,
  waitForEditorInstance,
} from './helpers/editor-instance';

test.describe('Markdown Editor CRUD Tests', () => {
  registerStopFileWatchingAfterEach();

  test('should save markdown files in subfolders via editor', async ({ appWindow }) => {
    test.setTimeout(60000);
    console.log('=== Testing markdown file saving in subfolders ===');

    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) return 0;
        return cy.nodes().length;
      });
    }, {
      message: 'Waiting for graph to load nodes',
      timeout: 15000,
    }).toBeGreaterThan(0);

    console.log('✓ Graph loaded with nodes');

    const nodeId = await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      const nodes = cy.nodes();
      let foundNodeId: string | null = null;

      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const label = node.data('label');
        if (label === 'Setting up Agent in Feedback Loop') {
          foundNodeId = node.id();
          break;
        }
      }

      if (!foundNodeId) {
        const availableLabels: string[] = [];
        for (let i = 0; i < Math.min(10, nodes.length); i++) {
          availableLabels.push(nodes[i].data('label'));
        }
        throw new Error(`Node with label "Setting up Agent in Feedback Loop" not found. Available nodes: ${availableLabels.join(', ')}`);
      }

      return foundNodeId;
    });

    console.log(`✓ Found node with ID: ${nodeId}`);

    // nodeId may be absolute or relative to FIXTURE_PROJECT_PATH.
    const testFilePath = path.isAbsolute(nodeId)
      ? (nodeId.endsWith('.md') ? nodeId : `${nodeId}.md`)
      : (nodeId.endsWith('.md')
          ? path.join(FIXTURE_PROJECT_PATH, nodeId)
          : path.join(FIXTURE_PROJECT_PATH, `${nodeId}.md`));
    const originalContent = await fs.readFile(testFilePath, 'utf-8');
    console.log('Original file content length:', originalContent.length);

    await appWindow.evaluate((nId) => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      const node = cy.getElementById(nId);
      if (node.length === 0) throw new Error(`${nId} node not found`);

      node.trigger('tap');
    }, nodeId);

    // Window ID format is `window-${nodeId}-editor` per createWindowChrome.
    const editorWindowId = `window-${nodeId}-editor`;
    const editorInstanceId = getEditorInstanceId(nodeId);
    await expect.poll(async () => {
      return appWindow.evaluate((winId) => {
        const editorWindow = document.getElementById(winId);
        return editorWindow !== null;
      }, editorWindowId);
    }, {
      message: 'Waiting for editor window to appear',
      timeout: 5000,
    }).toBe(true);

    console.log('✓ Editor window opened');

    // CSS.escape isn't available in Node.js, manually escape special chars.
    const escapedEditorWindowId = editorWindowId.replace(/[./]/g, '\\$&');
    await appWindow.waitForSelector(`#${escapedEditorWindowId} .cm-editor`, { timeout: 5000 });
    await waitForEditorInstance(appWindow, editorInstanceId);

    // The renderer syncs editor content from graph state ~300ms after load
    // (renderer:loading-cleared fires ~1333ms after renderer start). Typing
    // before this sync would race the sync overwriting our edit.
    await appWindow.waitForTimeout(2000);

    // Replace content via real keyboard input so CM6 tags the transaction as
    // `input.type` and the autosave path actually fires.
    const testContent = '# Setting up Agent in Feedback Loop\n\nTEST MODIFICATION - This content was changed by the e2e test.\n\nThis is a test to verify file sync works correctly.';

    await focusEditorInstance(appWindow, editorInstanceId);
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await appWindow.keyboard.press(`${modifier}+A`);
    await appWindow.keyboard.type(testContent);

    await expect.poll(async () => readEditorValue(appWindow, editorInstanceId), {
      message: 'Waiting for typed content to appear in CodeMirror',
      timeout: 5000,
    }).toBe(testContent);

    console.log('✓ Content modified in editor');

    // Pipeline: autosave debounce → daemon write → file watcher/SSE.
    await expect.poll(async () => {
      const content = await fs.readFile(testFilePath, 'utf-8');
      return content.includes(testContent);
    }, {
      message: 'Waiting for auto-save to write test content to disk',
      timeout: 15_000,
      intervals: [200, 500, 1000, 2000],
    }).toBe(true);

    const savedContentBeforeClose = await fs.readFile(testFilePath, 'utf-8');
    console.log('Saved file content length (before close):', savedContentBeforeClose.length);

    expect(savedContentBeforeClose).toContain(testContent);
    expectFrontmatterShapePreserved(savedContentBeforeClose, originalContent);
    console.log('✓ File content saved correctly to disk BEFORE close');

    // Click the actual close button (not just remove the shadow node).
    console.log('Clicking close button...');
    await appWindow.evaluate((winId) => {
      const escapedWinId = CSS.escape(winId);
      const closeButton = document.querySelector(`#${escapedWinId} .traffic-light-close`) as HTMLButtonElement | null;
      if (!closeButton) throw new Error('Close button not found!');
      closeButton.click();
    }, editorWindowId);

    await appWindow.waitForTimeout(200);

    const savedContentAfterClose = await fs.readFile(testFilePath, 'utf-8');
    console.log('Saved file content length (after close):', savedContentAfterClose.length);

    expect(savedContentAfterClose).toContain(testContent);
    expectFrontmatterShapePreserved(savedContentAfterClose, originalContent);
    console.log('✓ File content STILL correct after clicking close button');

    // Re-open to confirm content persisted across editor mount cycles.
    await appWindow.evaluate((nId) => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.getElementById(nId);
      node.trigger('tap');
    }, nodeId);

    await expect.poll(async () => {
      return appWindow.evaluate((winId) => {
        const editorWindow = document.getElementById(winId);
        return editorWindow !== null;
      }, editorWindowId);
    }, {
      message: 'Waiting for editor to re-open',
      timeout: 5000,
    }).toBe(true);

    await appWindow.waitForSelector(`#${escapedEditorWindowId} .cm-editor`, { timeout: 5000 });
    await waitForEditorInstance(appWindow, editorInstanceId);

    const editorContent = await readEditorValue(appWindow, editorInstanceId);
    // Editor shows content without frontmatter (frontmatter is stripped when displaying).
    expect(editorContent).toContain(testContent);
    console.log('✓ Editor shows saved content after reopening');

    await appWindow.evaluate((winId) => {
      const escapedWinId = CSS.escape(winId);
      const closeButton = document.querySelector(`#${escapedWinId} .traffic-light-close`) as HTMLButtonElement | null;
      if (closeButton) closeButton.click();
    }, editorWindowId);
    await appWindow.waitForTimeout(200);

    await fs.writeFile(testFilePath, originalContent, 'utf-8');
    console.log('✓ Original file content restored');

    await appWindow.waitForTimeout(200);
    console.log('✓ Markdown file save test completed');
  });

  test('should preserve exact content typed through real keyboard input', async ({ appWindow }) => {
    test.setTimeout(60000);
    console.log('=== Testing real keyboard typing into markdown editor ===');

    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        return cy?.nodes().length ?? 0;
      });
    }, {
      message: 'Waiting for graph to load nodes',
      timeout: 15000,
    }).toBeGreaterThan(0);

    const nodeId = await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      const nodes = cy.nodes();
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (node.data('label') === 'Setting up Agent in Feedback Loop') {
          return node.id();
        }
      }

      throw new Error('Node with label "Setting up Agent in Feedback Loop" not found');
    });

    const testFilePath = path.isAbsolute(nodeId)
      ? (nodeId.endsWith('.md') ? nodeId : `${nodeId}.md`)
      : (nodeId.endsWith('.md')
          ? path.join(FIXTURE_PROJECT_PATH, nodeId)
          : path.join(FIXTURE_PROJECT_PATH, `${nodeId}.md`));
    const originalContent = await fs.readFile(testFilePath, 'utf-8');

    const editorWindowId = `window-${nodeId}-editor`;
    const editorInstanceId = getEditorInstanceId(nodeId);
    try {
      await appWindow.evaluate((nId) => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('Cytoscape not initialized');
        const node = cy.getElementById(nId);
        if (node.length === 0) throw new Error(`${nId} node not found`);
        node.trigger('tap');
      }, nodeId);

      await expect.poll(async () => {
        return appWindow.evaluate((winId) => document.getElementById(winId) !== null, editorWindowId);
      }, {
        message: 'Waiting for editor window to appear',
        timeout: 5000,
      }).toBe(true);

      const escapedEditorWindowId = editorWindowId.replace(/[./]/g, '\\$&');
      const editorSelector = `#${escapedEditorWindowId} .cm-content`;
      await appWindow.waitForSelector(editorSelector, { timeout: 5000 });
      await waitForEditorInstance(appWindow, editorInstanceId);

      await focusEditorInstance(appWindow, editorInstanceId);
      const focused = await appWindow.evaluate((winId) => {
        const editorElement = document.querySelector(`#${CSS.escape(winId)} .cm-content`);
        return document.activeElement === editorElement
          || !!document.activeElement?.closest('.cm-editor');
      }, editorWindowId);
      expect(focused).toBe(true);

      const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
      await appWindow.keyboard.press(`${modifier}+A`);

      const typedContent = [
        '# Keyboard Input Smoke',
        '',
        'Typed through Playwright keyboard events.',
        'Symbols: []{}() _ - + = / \\',
        'Final line.',
      ].join('\n');
      await appWindow.keyboard.type(typedContent);

      await expect.poll(async () => readEditorValue(appWindow, editorInstanceId), {
        message: 'Waiting for typed content to appear exactly in CodeMirror',
        timeout: 5000,
      }).toBe(typedContent);

      await appWindow.waitForTimeout(1000);
      const savedContent = await fs.readFile(testFilePath, 'utf-8');
      expect(savedContent).toContain(typedContent);
      expectFrontmatterShapePreserved(savedContent, originalContent);

      console.log('✓ Real keyboard editor input saved exactly');
    } finally {
      await appWindow.evaluate((winId) => {
        const closeButton = document.querySelector(`#${CSS.escape(winId)} .traffic-light-close`) as HTMLButtonElement | null;
        if (closeButton) closeButton.click();
      }, editorWindowId).catch(() => undefined);
      await appWindow.waitForTimeout(200).catch(() => undefined);
      await fs.writeFile(testFilePath, originalContent, 'utf-8');
      await appWindow.waitForTimeout(200).catch(() => undefined);
    }
  });
});

export { test };
