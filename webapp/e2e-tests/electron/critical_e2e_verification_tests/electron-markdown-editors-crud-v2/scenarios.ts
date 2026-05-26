import { expect } from '@playwright/test';
import type { EdgeSingular } from 'cytoscape';
import * as fs from 'fs/promises';
import {
  closeEditor,
  expectFrontmatterShapePreserved,
  findNodeIdByLabel,
  focusEditor,
  getEditorContent,
  markdownFilePathForNode,
  openEditorForNode,
  replaceEditorContent,
  waitForCodeMirror,
  waitForEditorWindow,
  waitForGraphNodes,
} from './editor-helpers';
import type { AppWindow, CodeMirrorElement, ExtendedWindow } from './types';

export async function saveMarkdownFilesInSubfoldersViaEditor(appWindow: AppWindow): Promise<void> {
  console.log('=== Testing markdown file saving in subfolders ===');

  await waitForGraphNodes(appWindow);
  console.log('✓ Graph loaded with nodes');

  const nodeId = await findNodeIdByLabel(appWindow, 'Setting up Agent in Feedback Loop');
  console.log(`✓ Found node with ID: ${nodeId}`);

  const testFilePath = markdownFilePathForNode(nodeId);
  const originalContent = await fs.readFile(testFilePath, 'utf-8');
  console.log('Original file content length:', originalContent.length);

  const editorWindowId = await openEditorForNode(appWindow, nodeId);
  console.log('✓ Editor window opened');

  // Wait for the renderer's loading cycle to settle before dispatching.
  // The renderer syncs editor content from graph state ~300ms after load.
  await appWindow.waitForTimeout(2000);

  const testContent = [
    '# Setting up Agent in Feedback Loop',
    '',
    'TEST MODIFICATION - This content was changed by the e2e test.',
    '',
    'This is a test to verify file sync works correctly.'
  ].join('\n');
  await replaceEditorContent(appWindow, editorWindowId, testContent);
  console.log('✓ Content modified in editor');

  await expect.poll(async () => {
    const content = await fs.readFile(testFilePath, 'utf-8');
    return content.includes(testContent);
  }, {
    message: 'Waiting for auto-save to write test content to disk',
    timeout: 15_000,
    intervals: [200, 500, 1000, 2000]
  }).toBe(true);

  const savedContentBeforeClose = await fs.readFile(testFilePath, 'utf-8');
  console.log('Saved file content length (before close):', savedContentBeforeClose.length);

  expect(savedContentBeforeClose).toContain(testContent);
  expectFrontmatterShapePreserved(savedContentBeforeClose, originalContent);
  console.log('✓ File content saved correctly to disk BEFORE close');

  console.log('Clicking close button...');
  await appWindow.evaluate((winId) => {
    const closeButton = document.querySelector(`#${CSS.escape(winId)} .traffic-light-close`) as HTMLButtonElement | null;
    if (!closeButton) throw new Error('Close button not found!');
    closeButton.click();
  }, editorWindowId);
  await appWindow.waitForTimeout(200);

  const savedContentAfterClose = await fs.readFile(testFilePath, 'utf-8');
  console.log('Saved file content length (after close):', savedContentAfterClose.length);

  expect(savedContentAfterClose).toContain(testContent);
  expectFrontmatterShapePreserved(savedContentAfterClose, originalContent);
  console.log('✓ File content STILL correct after clicking close button');

  const reopenedEditorWindowId = await openEditorForNode(appWindow, nodeId);
  await waitForEditorWindow(appWindow, reopenedEditorWindowId, 'Waiting for editor to re-open');
  await waitForCodeMirror(appWindow, reopenedEditorWindowId);

  const editorContent = await getEditorContent(appWindow, reopenedEditorWindowId);
  expect(editorContent).toContain(testContent);
  console.log('✓ Editor shows saved content after reopening');

  await closeEditor(appWindow, reopenedEditorWindowId);
  await appWindow.waitForTimeout(200);

  await fs.writeFile(testFilePath, originalContent, 'utf-8');
  console.log('✓ Original file content restored');

  await appWindow.waitForTimeout(200);
  console.log('✓ Markdown file save test completed');
}

export async function preserveExactContentTypedThroughKeyboard(appWindow: AppWindow): Promise<void> {
  console.log('=== Testing real keyboard typing into markdown editor ===');

  await waitForGraphNodes(appWindow);

  const nodeId = await findNodeIdByLabel(appWindow, 'Setting up Agent in Feedback Loop');
  const testFilePath = markdownFilePathForNode(nodeId);
  const originalContent = await fs.readFile(testFilePath, 'utf-8');
  const editorWindowId = `window-${nodeId}-editor`;

  try {
    await openEditorForNode(appWindow, nodeId);

    const focused = await focusEditor(appWindow, editorWindowId);
    expect(focused).toBe(true);

    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await appWindow.keyboard.press(`${modifier}+A`);
    await expect.poll(async () => {
      return appWindow.evaluate((winId) => {
        const editorElement = document.querySelector(`#${CSS.escape(winId)} .cm-content`) as CodeMirrorElement | null;
        const view = editorElement?.cmView?.view;
        if (!view) return null;
        const selection = view.state.selection.main;
        return { from: selection.from, to: selection.to, length: view.state.doc.length };
      }, editorWindowId);
    }, {
      message: 'Waiting for keyboard select-all to reach CodeMirror',
      timeout: 5000
    }).toEqual(expect.objectContaining({ from: 0 }));

    const typedContent = [
      '# Keyboard Input Smoke',
      '',
      'Typed through Playwright keyboard events.',
      'Symbols: []{}() _ - + = / \\',
      'Final line.'
    ].join('\n');
    await appWindow.keyboard.type(typedContent);

    await expect.poll(async () => {
      return getEditorContent(appWindow, editorWindowId);
    }, {
      message: 'Waiting for typed content to appear exactly in CodeMirror',
      timeout: 5000
    }).toBe(typedContent);

    await appWindow.waitForTimeout(1000);
    const savedContent = await fs.readFile(testFilePath, 'utf-8');
    expect(savedContent).toContain(typedContent);
    expectFrontmatterShapePreserved(savedContent, originalContent);

    console.log('✓ Real keyboard editor input saved exactly');
  } finally {
    await closeEditor(appWindow, editorWindowId).catch(() => undefined);
    await appWindow.waitForTimeout(200).catch(() => undefined);
    await fs.writeFile(testFilePath, originalContent, 'utf-8');
    await appWindow.waitForTimeout(200).catch(() => undefined);
  }
}

export async function updateGraphWhenWikilinkIsAddedViaEditor(appWindow: AppWindow): Promise<void> {
  console.log('=== Testing graph update when adding wikilink ===');

  await waitForGraphNodes(appWindow);
  console.log('✓ Graph loaded with nodes');

  const nodeId = 'introduction';
  const testFilePath = markdownFilePathForNode(nodeId);
  const originalContent = await fs.readFile(testFilePath, 'utf-8');

  const initialEdges = await appWindow.evaluate((nId) => {
    const cy = (window as ExtendedWindow).cytoscapeInstance;
    if (!cy) throw new Error('Cytoscape not initialized');

    const node = cy.getElementById(nId);
    if (node.length === 0) throw new Error(`${nId} node not found`);

    const connectedEdges = node.connectedEdges();
    return {
      totalEdges: cy.edges().length,
      nodeEdgeCount: connectedEdges.length,
      edgeTargets: connectedEdges.map((e: EdgeSingular) => ({
        source: e.source().id(),
        target: e.target().id()
      }))
    };
  }, nodeId);

  console.log(`Initial outgoingEdges for ${nodeId} node:`, initialEdges.nodeEdgeCount);
  console.log('Initial total outgoingEdges:', initialEdges.totalEdges);

  await appWindow.evaluate((nId) => {
    const cy = (window as ExtendedWindow).cytoscapeInstance;
    if (!cy) throw new Error('Cytoscape not initialized');
    const node = cy.getElementById(nId);
    if (node.length === 0) throw new Error(`${nId} node not found for tap`);
    node.trigger('tap');
  }, nodeId);

  const editorWindowId = `window-editor-${nodeId}`;
  await waitForEditorWindow(appWindow, editorWindowId, 'Waiting for editor to open');
  console.log('✓ Editor opened');
  await waitForCodeMirror(appWindow, editorWindowId);

  const newContent = `${originalContent}\n\nNew section linking to [[README]] for testing.`;
  await replaceEditorContent(appWindow, editorWindowId, newContent, { annotateUserInput: false });
  console.log('✓ Added wikilink to README');

  await appWindow.waitForTimeout(2000);

  const updatedEdges = await appWindow.evaluate((nId) => {
    const cy = (window as ExtendedWindow).cytoscapeInstance;
    if (!cy) throw new Error('Cytoscape not initialized');

    const node = cy.getElementById(nId);
    const connectedEdges = node.connectedEdges();

    return {
      totalEdges: cy.edges().length,
      nodeEdgeCount: connectedEdges.length,
      edgeTargets: connectedEdges.map((e) => {
        const edge = e as EdgeSingular;
        return {
          source: edge.source().id(),
          target: edge.target().id()
        };
      }),
      hasREADMEEdge: connectedEdges.some((e) => {
        const edge = e as EdgeSingular;
        return (edge.source().id() === nId && edge.target().id() === 'README') ||
          (edge.source().id() === 'README' && edge.target().id() === nId);
      })
    };
  }, nodeId);

  console.log(`Updated outgoingEdges for ${nodeId} node:`, updatedEdges.nodeEdgeCount);
  console.log('Updated total outgoingEdges:', updatedEdges.totalEdges);
  console.log('Has README edge:', updatedEdges.hasREADMEEdge);

  expect(updatedEdges.totalEdges).toBeGreaterThan(initialEdges.totalEdges);
  expect(updatedEdges.hasREADMEEdge).toBe(true);
  console.log('✓ New edge to README node created in graph');

  await fs.writeFile(testFilePath, originalContent, 'utf-8');
  console.log('✓ Original file content restored');

  await appWindow.waitForTimeout(2000);
  console.log('✓ Graph wikilink update test completed');
}

export async function syncExternalFileChangesToOpenEditors(appWindow: AppWindow): Promise<void> {
  console.log('=== Testing bidirectional sync: external changes -> open editor ===');

  await waitForGraphNodes(appWindow);
  console.log('✓ Graph loaded with nodes');

  const nodeId = await findNodeIdByLabel(appWindow, 'Identify Relevant Test');
  console.log(`✓ Found node with ID: ${nodeId}`);

  const testFilePath = markdownFilePathForNode(nodeId);
  const originalContent = await fs.readFile(testFilePath, 'utf-8');
  console.log('Original file content:', originalContent.substring(0, 50) + '...');

  const editorWindowId = await openEditorForNode(appWindow, nodeId);
  console.log('✓ Editor opened');

  const initialEditorContent = await getEditorContent(appWindow, editorWindowId);
  expect(initialEditorContent).not.toBeNull();
  expect(initialEditorContent).toContain('# Identify Relevant Test');
  console.log('✓ Editor shows original content (without frontmatter)');

  const externallyChangedContent = [
    '---',
    '---',
    '# Identify Relevant Test',
    '',
    '**EXTERNAL CHANGE** - This file was changed by an external process!',
    '',
    'The editor should automatically sync to show this change.'
  ].join('\n');
  await fs.writeFile(testFilePath, externallyChangedContent, 'utf-8');
  console.log('✓ File changed externally');

  const expectedEditorContent = [
    '# Identify Relevant Test',
    '',
    '**EXTERNAL CHANGE** - This file was changed by an external process!',
    '',
    'The editor should automatically sync to show this change.'
  ].join('\n');
  await expect.poll(async () => {
    return getEditorContent(appWindow, editorWindowId);
  }, {
    message: 'Waiting for editor to sync external file change',
    timeout: 15000,
    intervals: [500, 1000, 2000],
  }).toBe(expectedEditorContent);
  console.log('✓ Editor synced with external file change');

  await closeEditor(appWindow, editorWindowId);
  await appWindow.waitForTimeout(200);

  await fs.writeFile(testFilePath, originalContent, 'utf-8');
  console.log('✓ Original file content restored');

  await appWindow.waitForTimeout(200);
  console.log('✓ Bidirectional sync test completed');
}
