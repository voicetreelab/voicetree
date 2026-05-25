import type { Page } from '@playwright/test';
import type { ExtendedWindow } from './types';

export async function getNodeIds(appWindow: Page): Promise<string[]> {
  return await appWindow.evaluate(() => {
    const cy = (window as ExtendedWindow).cytoscapeInstance;
    if (!cy) throw new Error('Cytoscape not available');
    return cy.nodes().map(n => n.id());
  });
}

export async function addReadOnLinkPath(appWindow: Page, readPath: string): Promise<{ success: boolean }> {
  return await appWindow.evaluate(async (pathToAdd: string) => {
    const api = (window as ExtendedWindow).electronAPI;
    if (!api) throw new Error('electronAPI not available');
    return await api.main.addReadOnLinkPath(pathToAdd);
  }, readPath);
}

export async function getSourceNodeData(appWindow: Page): Promise<unknown> {
  return await appWindow.evaluate(async () => {
    const cy = (window as ExtendedWindow).cytoscapeInstance;
    const api = (window as ExtendedWindow).electronAPI;
    if (!cy) throw new Error('Cytoscape not available');

    const sourceNode = cy.nodes().filter(n => n.id().includes('source-node'))[0];
    if (!sourceNode) return null;

    let graphStoreEdges: unknown = null;
    if (api) {
      try {
        const graph = await api.main.getGraph();
        if (graph) {
          const sourceNodeInStore = Object.values(graph.nodes as Record<string, {
            absoluteFilePathIsID: string;
            outgoingEdges: { targetId: string; label: string }[];
          }>).find(n => n.absoluteFilePathIsID.includes('source-node'));
          graphStoreEdges = sourceNodeInStore?.outgoingEdges;
        }
      } catch (e) {
        graphStoreEdges = `error: ${e}`;
      }
    }

    return {
      id: sourceNode.id(),
      cytoscapeEdges: cy.edges().filter(e => e.source().id() === sourceNode.id()).map(e => ({
        targetId: e.target().id(),
        label: e.data('label')
      })),
      nodeData: sourceNode.data(),
      graphStoreEdges
    };
  });
}

export async function getAllEdges(appWindow: Page): Promise<Array<{ id: string; source: string; target: string }>> {
  return await appWindow.evaluate(() => {
    const cy = (window as ExtendedWindow).cytoscapeInstance;
    if (!cy) throw new Error('Cytoscape not available');
    return cy.edges().map(e => ({
      id: e.id(),
      source: e.source().id(),
      target: e.target().id()
    }));
  });
}
