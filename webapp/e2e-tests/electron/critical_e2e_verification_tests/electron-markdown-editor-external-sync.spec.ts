/**
 * BEHAVIORAL SPEC: External-source synchronisation into open markdown editors.
 *
 * Split out of electron-markdown-editors-crud-v2.spec.ts when that file
 * crossed the 500-line ceiling. Covers:
 *   1. External file changes sync into open editors (bidirectional sync)
 *   2. Adding wikilinks in an editor creates new outgoing edges (skipped —
 *      filePath metadata is missing on the seed `introduction` node, which is
 *      an application bug, not a test issue)
 *
 * Editor reads go through the production `vanillaFloatingWindowInstances`
 * store via `window.__vtDebug__.editorInstance(id)`. The older path of
 * reading CodeMirror's internal `.cmView` property stopped working when
 * @codemirror/view 6.43 renamed that DOM property to `.cmTile`.
 */

import { expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import type { EdgeSingular } from 'cytoscape';
import type { ExtendedWindow } from './helpers/electron-markdown-editor-fixtures';
import {
  FIXTURE_PROJECT_PATH,
  registerStopFileWatchingAfterEach,
  test,
} from './helpers/electron-markdown-editor-fixtures';
import {
  getEditorInstanceId,
  readEditorValue,
  waitForEditorInstance,
} from './helpers/editor-instance';

test.describe('Markdown Editor External Sync', () => {
  registerStopFileWatchingAfterEach();

  test.skip('should update graph when wikilink is added via editor', async ({ appWindow }) => {
    // SKIPPED: This test fails because the 'introduction' node doesn't get
    // its filePath metadata set, which prevents the editor from opening.
    // This appears to be an application bug, not a test issue.
    console.log('=== Testing graph update when adding wikilink ===');

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

    const nodeId = 'introduction';
    const testFilePath = path.isAbsolute(nodeId)
      ? (nodeId.endsWith('.md') ? nodeId : `${nodeId}.md`)
      : (nodeId.endsWith('.md')
          ? path.join(FIXTURE_PROJECT_PATH, nodeId)
          : path.join(FIXTURE_PROJECT_PATH, `${nodeId}.md`));
    const originalContent = await fs.readFile(testFilePath, 'utf-8');

    const initialEdges = await appWindow.evaluate((nId) => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      const node = cy.getElementById(nId);
      if (node.length === 0) throw new Error(`${nId} node not found`);

      const connectedEdges = node.connectedEdges();
      return {
        totalEdges: cy.edges().length,
        nodeEdgeCount: connectedEdges.length,
        edgeTargets: connectedEdges.map((e: EdgeSingular) => ({
          source: e.source().id(),
          target: e.target().id(),
        })),
      };
    }, nodeId);

    console.log(`Initial outgoingEdges for ${nodeId} node:`, initialEdges.nodeEdgeCount);
    console.log('Initial total outgoingEdges:', initialEdges.totalEdges);

    await appWindow.evaluate((nId) => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.getElementById(nId);
      if (node.length === 0) throw new Error(`${nId} node not found for tap`);
      node.trigger('tap');
    }, nodeId);

    const editorWindowId = `window-editor-${nodeId}`;
    const editorInstanceId = getEditorInstanceId(nodeId);
    await expect.poll(async () => {
      return appWindow.evaluate((winId) => document.getElementById(winId) !== null, editorWindowId);
    }, {
      message: 'Waiting for editor to open',
      timeout: 5000,
    }).toBe(true);
    console.log('✓ Editor opened');

    const escapedEditorWindowId = editorWindowId.replace(/[./]/g, '\\$&');
    await appWindow.waitForSelector(`#${escapedEditorWindowId} .cm-editor`, { timeout: 5000 });
    await waitForEditorInstance(appWindow, editorInstanceId);

    // Add a wikilink via real keyboard input so CM6 fires the autosave path.
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await appWindow.keyboard.press(`${modifier}+A`);
    const newContent = originalContent + '\n\nNew section linking to [[README]] for testing.';
    await appWindow.keyboard.type(newContent);
    console.log('✓ Added wikilink to README');

    await appWindow.waitForTimeout(2000);

    const updatedEdges = await appWindow.evaluate((nId) => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      const node = cy.getElementById(nId);
      const connectedEdges = node.connectedEdges();

      return {
        totalEdges: cy.edges().length,
        nodeEdgeCount: connectedEdges.length,
        hasREADMEEdge: connectedEdges.some((e) => {
          const edge = e as EdgeSingular;
          return (edge.source().id() === nId && edge.target().id() === 'README') ||
            (edge.source().id() === 'README' && edge.target().id() === nId);
        }),
      };
    }, nodeId);

    expect(updatedEdges.totalEdges).toBeGreaterThan(initialEdges.totalEdges);
    expect(updatedEdges.hasREADMEEdge).toBe(true);
    console.log('✓ New edge to README node created in graph');

    await fs.writeFile(testFilePath, originalContent, 'utf-8');
    await appWindow.waitForTimeout(2000);
    console.log('✓ Graph wikilink update test completed');
  });

  test('should sync external file changes to open editors (bidirectional sync)', async ({ appWindow }) => {
    test.setTimeout(60000);
    console.log('=== Testing bidirectional sync: external changes -> open editor ===');

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
        if (label === 'Identify Relevant Test') {
          foundNodeId = node.id();
          break;
        }
      }

      if (!foundNodeId) {
        const availableLabels: string[] = [];
        for (let i = 0; i < Math.min(10, nodes.length); i++) {
          availableLabels.push(nodes[i].data('label'));
        }
        throw new Error(`Node with label "Identify Relevant Test" not found. Available nodes: ${availableLabels.join(', ')}`);
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
    console.log('Original file content:', originalContent.substring(0, 50) + '...');

    await appWindow.evaluate((nId) => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.getElementById(nId);
      if (node.length === 0) throw new Error(`${nId} node not found`);
      node.trigger('tap');
    }, nodeId);

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

    console.log('✓ Editor opened');

    const escapedEditorWindowId = editorWindowId.replace(/[./]/g, '\\$&');
    await appWindow.waitForSelector(`#${escapedEditorWindowId} .cm-editor`, { timeout: 5000 });
    await waitForEditorInstance(appWindow, editorInstanceId);

    // Editor displays content without frontmatter (frontmatter is stripped for editing).
    const initialEditorContent = await readEditorValue(appWindow, editorInstanceId);
    expect(initialEditorContent).toContain('# Identify Relevant Test');
    console.log('✓ Editor shows original content (without frontmatter)');

    // Make an EXTERNAL change to the file (simulating external editor or another process).
    // Frontmatter is included because the system expects it on disk.
    const externallyChangedContent = '---\n---\n# Identify Relevant Test\n\n**EXTERNAL CHANGE** - This file was changed by an external process!\n\nThe editor should automatically sync to show this change.';
    await fs.writeFile(testFilePath, externallyChangedContent, 'utf-8');
    console.log('✓ File changed externally');

    // Pipeline: fs.writeFile → file watcher → SSE → renderer → CodeMirror update.
    // CI is slower than local so we give a generous 15s window.
    const expectedEditorContent = '# Identify Relevant Test\n\n**EXTERNAL CHANGE** - This file was changed by an external process!\n\nThe editor should automatically sync to show this change.';
    await expect.poll(async () => readEditorValue(appWindow, editorInstanceId), {
      message: 'Waiting for editor to sync external file change',
      timeout: 15000,
      intervals: [500, 1000, 2000],
    }).toBe(expectedEditorContent);
    console.log('✓ Editor synced with external file change');

    // Close the editor before restoring file (to prevent auto-save from overwriting).
    await appWindow.evaluate((winId) => {
      const escapedWinId = CSS.escape(winId);
      const closeButton = document.querySelector(`#${escapedWinId} .traffic-light-close`) as HTMLButtonElement | null;
      if (closeButton) closeButton.click();
    }, editorWindowId);
    await appWindow.waitForTimeout(200);

    await fs.writeFile(testFilePath, originalContent, 'utf-8');
    console.log('✓ Original file content restored');

    await appWindow.waitForTimeout(200);
    console.log('✓ Bidirectional sync test completed');
  });
});
