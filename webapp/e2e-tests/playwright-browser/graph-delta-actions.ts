import type { Page } from '@playwright/test';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { GraphDelta } from '@/pure/graph';
import type { ProjectedGraph } from '@vt/graph-state/contract';

interface GraphDeltaActionWindow extends Window {
  cytoscapeInstance?: CytoscapeCore;
  hostAPI?: {
    graph?: unknown;
    _triggerIpc?: (channel: string, ...args: unknown[]) => void;
  };
}

export async function sendGraphDelta(page: Page, graphDelta: GraphDelta): Promise<void> {
  const serializableDelta = graphDelta.map((action) => {
    if (action.type === 'UpsertNode' && action.nodeToUpsert.nodeUIMetadata.additionalYAMLProps instanceof Map) {
      return {
        ...action,
        nodeToUpsert: {
          ...action.nodeToUpsert,
          nodeUIMetadata: {
            ...action.nodeToUpsert.nodeUIMetadata,
            additionalYAMLProps: Array.from(action.nodeToUpsert.nodeUIMetadata.additionalYAMLProps.entries())
          }
        }
      };
    }
    return action;
  });

  await page.evaluate(async (delta) => {
    const reconstructedDelta = delta.map((action) => {
      if (action.type === 'UpsertNode' && Array.isArray(action.nodeToUpsert.nodeUIMetadata.additionalYAMLProps)) {
        return {
          ...action,
          nodeToUpsert: {
            ...action.nodeToUpsert,
            nodeUIMetadata: {
              ...action.nodeToUpsert.nodeUIMetadata,
              additionalYAMLProps: new Map(action.nodeToUpsert.nodeUIMetadata.additionalYAMLProps)
            }
          }
        };
      }
      return action;
    }) as GraphDelta;

    const hostAPI = (window as unknown as GraphDeltaActionWindow).hostAPI;
    if (!hostAPI) throw new Error('hostAPI not available');

    const { projectDelta } = await import('/src/shell/edge/UI-edge/graph/integration-tests/projectGraphDelta.ts');
    const projectedGraph = projectDelta(reconstructedDelta);

    const mockGraphAPI = hostAPI.graph as {
      _projectedGraphCallback?: (graph: ProjectedGraph) => void;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _graphState: { nodes: Record<string, any>; edges: any[] };
    };

    reconstructedDelta.forEach((nodeDelta) => {
      if (nodeDelta.type === 'UpsertNode') {
        const node = nodeDelta.nodeToUpsert;
        mockGraphAPI._graphState.nodes[node.absoluteFilePathIsID] = node;
      } else if (nodeDelta.type === 'DeleteNode') {
        delete mockGraphAPI._graphState.nodes[nodeDelta.nodeId];
      }
    });

    if (mockGraphAPI._projectedGraphCallback) {
      mockGraphAPI._projectedGraphCallback(projectedGraph);
      console.log('[Test] Triggered projected graph update via hostAPI callback');
    } else {
      console.error('[Test] No projected graph update callback registered!');
    }

    const triggerIpc = (hostAPI as unknown as { _triggerIpc?: (channel: string, ...args: unknown[]) => void })._triggerIpc;
    if (triggerIpc) {
      triggerIpc('ui:call', 'updateFloatingEditorsFromExternal', [reconstructedDelta]);
      console.log('[Test] Triggered ui:call for updateFloatingEditorsFromExternal');
    }
  }, serializableDelta);
}

export async function waitForCytoscapeReady(page: Page, timeout = 10000): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as GraphDeltaActionWindow).cytoscapeInstance,
    { timeout }
  );
}

export async function getNodeCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const cy = (window as unknown as GraphDeltaActionWindow).cytoscapeInstance;
    return cy ? cy.nodes().length : 0;
  });
}
