import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import * as path from 'path';
import { FIXTURE_VAULT_PATH } from './fixtures';
import type { CodeMirrorElement, ExtendedWindow } from './types';

export function expectFrontmatterShapePreserved(savedContent: string, originalContent: string): void {
  if (originalContent.startsWith('---\n')) {
    expect(savedContent).toMatch(/^---\n/);
    return;
  }

  expect(savedContent).not.toMatch(/^---\n/);
}

export function markdownFilePathForNode(nodeId: string): string {
  if (path.isAbsolute(nodeId)) {
    return nodeId.endsWith('.md') ? nodeId : `${nodeId}.md`;
  }

  return nodeId.endsWith('.md')
    ? path.join(FIXTURE_VAULT_PATH, nodeId)
    : path.join(FIXTURE_VAULT_PATH, `${nodeId}.md`);
}

export async function waitForGraphNodes(appWindow: Page): Promise<void> {
  await expect.poll(async () => {
    return appWindow.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      return cy?.nodes().length ?? 0;
    });
  }, {
    message: 'Waiting for graph to load nodes',
    timeout: 15000
  }).toBeGreaterThan(0);
}

export async function findNodeIdByLabel(appWindow: Page, expectedLabel: string): Promise<string> {
  return appWindow.evaluate((labelToFind) => {
    const cy = (window as ExtendedWindow).cytoscapeInstance;
    if (!cy) throw new Error('Cytoscape not initialized');

    const nodes = cy.nodes();
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.data('label') === labelToFind) {
        return node.id();
      }
    }

    const availableLabels: string[] = [];
    for (let i = 0; i < Math.min(10, nodes.length); i++) {
      availableLabels.push(nodes[i].data('label'));
    }
    throw new Error(`Node with label "${labelToFind}" not found. Available nodes: ${availableLabels.join(', ')}`);
  }, expectedLabel);
}

export async function openEditorForNode(appWindow: Page, nodeId: string): Promise<string> {
  await appWindow.evaluate((nId) => {
    const cy = (window as ExtendedWindow).cytoscapeInstance;
    if (!cy) throw new Error('Cytoscape not initialized');

    const node = cy.getElementById(nId);
    if (node.length === 0) throw new Error(`${nId} node not found`);
    node.trigger('tap');
  }, nodeId);

  const editorWindowId = `window-${nodeId}-editor`;
  await waitForEditorWindow(appWindow, editorWindowId, 'Waiting for editor window to appear');
  await waitForCodeMirror(appWindow, editorWindowId);
  return editorWindowId;
}

export async function waitForEditorWindow(
  appWindow: Page,
  editorWindowId: string,
  message: string,
): Promise<void> {
  await expect.poll(async () => {
    return appWindow.evaluate((winId) => document.getElementById(winId) !== null, editorWindowId);
  }, {
    message,
    timeout: 5000
  }).toBe(true);
}

export async function waitForCodeMirror(appWindow: Page, editorWindowId: string): Promise<void> {
  const escapedEditorWindowId = editorWindowId.replace(/[./]/g, '\\$&');
  await appWindow.waitForSelector(`#${escapedEditorWindowId} .cm-content`, { timeout: 5000 });
}

export async function replaceEditorContent(
  appWindow: Page,
  editorWindowId: string,
  newContent: string,
  options: { annotateUserInput?: boolean } = { annotateUserInput: true },
): Promise<void> {
  await appWindow.evaluate(({ windowId, content, annotateUserInput }: { windowId: string; content: string; annotateUserInput: boolean }) => {
    const editorElement = document.querySelector(`#${CSS.escape(windowId)} .cm-content`) as HTMLElement | null;
    if (!editorElement) throw new Error('Editor content element not found');

    const cmView = (editorElement as CodeMirrorElement).cmView?.view;
    if (!cmView) throw new Error('CodeMirror view not found');

    cmView.dispatch({
      changes: { from: 0, to: cmView.state.doc.length, insert: content },
      ...(annotateUserInput ? { userEvent: 'input' } : {})
    });
  }, {
    windowId: editorWindowId,
    content: newContent,
    annotateUserInput: options.annotateUserInput ?? true
  });
}

export async function getEditorContent(appWindow: Page, editorWindowId: string): Promise<string | null> {
  return appWindow.evaluate((winId) => {
    const editorElement = document.querySelector(`#${CSS.escape(winId)} .cm-content`) as HTMLElement | null;
    if (!editorElement) return null;

    const cmView = (editorElement as CodeMirrorElement).cmView?.view;
    if (!cmView) return null;

    return cmView.state.doc.toString();
  }, editorWindowId);
}

export async function closeEditor(appWindow: Page, editorWindowId: string): Promise<void> {
  await appWindow.evaluate((winId) => {
    const closeButton = document.querySelector(`#${CSS.escape(winId)} .traffic-light-close`) as HTMLButtonElement | null;
    if (closeButton) closeButton.click();
  }, editorWindowId);
}

export async function focusEditor(appWindow: Page, editorWindowId: string): Promise<boolean> {
  return appWindow.evaluate((winId) => {
    const editorElement = document.querySelector(`#${CSS.escape(winId)} .cm-content`) as CodeMirrorElement | null;
    if (!editorElement?.cmView?.view) return false;
    editorElement.cmView.view.focus();
    return document.activeElement === editorElement
      || !!document.activeElement?.closest('.cm-editor');
  }, editorWindowId);
}
