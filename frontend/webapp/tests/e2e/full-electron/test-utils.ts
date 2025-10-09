import { Page } from '@playwright/test';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { Core as CytoscapeCore, NodeSingular, EdgeSingular } from 'cytoscape';

export interface ExtendedWindow extends Window {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: {
    startFileWatching: (dir: string) => Promise<{ success: boolean; directory?: string; error?: string }>;
    stopFileWatching: () => Promise<{ success: boolean; error?: string }>;
    getWatchStatus: () => Promise<{ isWatching: boolean; directory?: string }>;
    onInitialScanComplete: (callback: (data: { directory: string }) => void) => void;
  };
}

/**
 * Wait for app to fully load with Cytoscape instance
 */
export async function waitForAppLoad(appWindow: Page, timeout = 15000): Promise<void> {
  await appWindow.waitForLoadState('domcontentloaded');
  await appWindow.waitForFunction(() => {
    const w = window as ExtendedWindow;
    return w.cytoscapeInstance;
  }, { timeout });
  await appWindow.waitForTimeout(1000);
}

/**
 * Start file watching for a directory
 */
export async function startWatching(appWindow: Page, tempDir: string): Promise<void> {
  await appWindow.evaluate((dir) => {
    const w = window as ExtendedWindow;
    return w.electronAPI?.startFileWatching(dir);
  }, tempDir);

  await appWindow.waitForTimeout(1000);

  const status = await appWindow.evaluate(() => {
    const w = window as ExtendedWindow;
    return w.electronAPI?.getWatchStatus();
  });

  if (!status?.isWatching) {
    throw new Error(`File watching failed to start: ${JSON.stringify(status)}`);
  }

  // Wait for chokidar to be fully ready
  await appWindow.waitForTimeout(3000);
}

/**
 * Stop file watching
 */
export async function stopWatching(appWindow: Page): Promise<void> {
  await appWindow.evaluate(() => {
    const w = window as ExtendedWindow;
    return w.electronAPI?.stopFileWatching();
  });
}

/**
 * Get current graph state
 */
export async function getGraphState(appWindow: Page): Promise<{ nodes: number; edges: number } | null> {
  return appWindow.evaluate(() => {
    const w = window as ExtendedWindow;
    const cy = w.cytoscapeInstance;
    return cy ? { nodes: cy.nodes().length, edges: cy.edges().length } : null;
  });
}

/**
 * Poll for expected node count
 */
export async function pollForNodeCount(
  appWindow: Page,
  expectedCount: number,
  timeout = 8000
): Promise<number> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    const count = await appWindow.evaluate(() => {
      const w = window as ExtendedWindow;
      return w.cytoscapeInstance?.nodes().length || 0;
    });
    if (count === expectedCount) return count;
    await appWindow.waitForTimeout(200);
  }
  throw new Error(`Timeout waiting for ${expectedCount} nodes`);
}

/**
 * Poll for expected graph state
 */
export async function pollForGraphState(
  appWindow: Page,
  expected: { nodes?: number; edges?: number },
  timeout = 8000
): Promise<{ nodes: number; edges: number }> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    const state = await getGraphState(appWindow);
    if (state) {
      const nodesMatch = expected.nodes === undefined || state.nodes === expected.nodes;
      const edgesMatch = expected.edges === undefined || state.edges === expected.edges;
      if (nodesMatch && edgesMatch) return state;
    }
    await appWindow.waitForTimeout(200);
  }
  throw new Error(`Timeout waiting for graph state ${JSON.stringify(expected)}`);
}

/**
 * Create a markdown file with a small delay
 */
export async function createMarkdownFile(
  tempDir: string,
  filename: string,
  content: string,
  delay = 200
): Promise<string> {
  const filePath = path.join(tempDir, filename);
  await fs.writeFile(filePath, content);
  await new Promise(resolve => setTimeout(resolve, delay));
  return filePath;
}

/**
 * Get node data from the graph
 */
export async function getNodeData(appWindow: Page, index = 0): Promise<{ id: string; label: string } | null> {
  return appWindow.evaluate((idx) => {
    const w = window as ExtendedWindow;
    const cy = w.cytoscapeInstance;
    if (!cy || cy.nodes().length <= idx) return null;
    const node = cy.nodes()[idx];
    return { id: node.data('id'), label: node.data('label') };
  }, index);
}

/**
 * Check graph integrity (no orphaned edges, all nodes valid)
 */
export async function checkGraphIntegrity(appWindow: Page): Promise<{
  nodeCount: number;
  edgeCount: number;
  orphanedEdges: number;
  allNodesValid: boolean;
}> {
  return appWindow.evaluate(() => {
    const w = window as ExtendedWindow;
    const cy = w.cytoscapeInstance;
    if (!cy) return { nodeCount: 0, edgeCount: 0, orphanedEdges: 0, allNodesValid: false };

    const nodes = cy.nodes();
    const edges = cy.edges();

    const orphanedEdges = edges.filter((edge: EdgeSingular) => {
      const sourceExists = nodes.some((n: NodeSingular) => n.id() === edge.source().id());
      const targetExists = nodes.some((n: NodeSingular) => n.id() === edge.target().id());
      return !sourceExists || !targetExists;
    });

    return {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      orphanedEdges: orphanedEdges.length,
      allNodesValid: nodes.every((n: NodeSingular) => n.data('id') && n.data('label'))
    };
  });
}

/**
 * Right-click on first node to open context menu
 */
export async function rightClickFirstNode(appWindow: Page): Promise<void> {
  await appWindow.evaluate(() => {
    const w = window as ExtendedWindow;
    const cy = w.cytoscapeInstance;
    if (cy && cy.nodes().length > 0) {
      const node = cy.nodes().first();
      const position = node.renderedPosition();
      const event = new MouseEvent('contextmenu', {
        view: window,
        bubbles: true,
        cancelable: true,
        clientX: position.x,
        clientY: position.y,
        button: 2
      });
      const canvas = cy.container().querySelector('canvas');
      canvas?.dispatchEvent(event);
    }
  });
}

/**
 * Get theme state
 */
export async function getThemeState(appWindow: Page): Promise<{
  isDarkMode: boolean;
  nodeColor: string;
  edgeColor: string;
}> {
  return appWindow.evaluate(() => {
    const w = window as ExtendedWindow;
    const cy = w.cytoscapeInstance;
    if (!cy || cy.nodes().length === 0 || cy.edges().length === 0) {
      return { isDarkMode: false, nodeColor: '', edgeColor: '' };
    }

    return {
      isDarkMode: document.documentElement.classList.contains('dark'),
      nodeColor: cy.nodes().first().style('color'),
      edgeColor: cy.edges().first().style('color')
    };
  });
}

/**
 * Sample animation state multiple times to check if it's animating
 */
export async function checkBreathingAnimation(
  appWindow: Page,
  nodeId?: string,
  samples = 3,
  interval = 400
): Promise<{
  isWidthAnimating: boolean;
  isColorAnimating: boolean;
  breathingActive: boolean;
  animationType: string;
  borderWidthSamples: number[];
  borderColorSamples: string[];
}> {
  return appWindow.evaluate(async ({ id, numSamples, sampleInterval }) => {
    const w = window as ExtendedWindow;
    const cy = w.cytoscapeInstance;
    if (!cy) throw new Error('Cytoscape not initialized');

    const node = id ? cy.getElementById(id) : cy.nodes().first();
    if (!node || node.length === 0) throw new Error('Node not found');

    const widthSamples: number[] = [];
    const colorSamples: string[] = [];
    const classSamples: string[][] = [];

    for (let i = 0; i < numSamples; i++) {
      widthSamples.push(parseFloat(node.style('border-width')));
      colorSamples.push(node.style('border-color'));
      classSamples.push(node.classes());
      await new Promise(resolve => setTimeout(resolve, sampleInterval));
    }

    // Check if breathing classes are toggling (expand/contract alternating)
    const hasExpandClass = (classes: string[]) =>
      classes.some(c => c.includes('breathing') && c.includes('expand'));
    const hasContractClass = (classes: string[]) =>
      classes.some(c => c.includes('breathing') && c.includes('contract'));

    const classesChanging = classSamples.some((classes, i) => {
      if (i === 0) return false;
      const prevHasExpand = hasExpandClass(classSamples[i - 1]);
      const currHasExpand = hasExpandClass(classes);
      const prevHasContract = hasContractClass(classSamples[i - 1]);
      const currHasContract = hasContractClass(classes);
      return prevHasExpand !== currHasExpand || prevHasContract !== currHasContract;
    });

    return {
      isWidthAnimating: classesChanging || widthSamples[0] !== widthSamples[1] || widthSamples[1] !== widthSamples[2],
      isColorAnimating: classesChanging || colorSamples[0] !== colorSamples[1] || colorSamples[1] !== colorSamples[2],
      breathingActive: node.data('breathingActive'),
      animationType: node.data('animationType'),
      borderWidthSamples: widthSamples,
      borderColorSamples: colorSamples
    };
  }, { id: nodeId, numSamples: samples, sampleInterval: interval });
}

/**
 * Stop breathing animation on a node by triggering mouseover
 */
export async function stopBreathingAnimation(appWindow: Page, nodeId?: string): Promise<void> {
  await appWindow.evaluate((id) => {
    const w = window as ExtendedWindow;
    const cy = w.cytoscapeInstance;
    if (!cy) return;
    const node = id ? cy.getElementById(id) : cy.nodes().first();
    if (node && node.length > 0) {
      node.emit('mouseover');
    }
  }, nodeId);
}

/**
 * Clear breathing animation on a node manually
 */
export async function clearBreathingAnimation(appWindow: Page, nodeId: string): Promise<void> {
  await appWindow.evaluate((id) => {
    const w = window as ExtendedWindow;
    const cy = w.cytoscapeInstance;
    if (!cy) return;
    const node = cy.getElementById(id);
    if (node.length > 0) {
      node.data('breathingActive', false);
      node.stop(true);
      node.style({
        'border-width': '0',
        'border-color': 'rgba(0, 0, 0, 0)',
        'border-opacity': 1
      });
    }
  }, nodeId);
}
