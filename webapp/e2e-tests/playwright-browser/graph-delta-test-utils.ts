import type { Core as CytoscapeCore } from 'cytoscape';
import type { ProjectedGraph } from '@vt/graph-state/contract';

export interface ExtendedWindow extends Window {
  cytoscapeInstance?: CytoscapeCore;
  _undoRedoTracker?: {
    undoCalls: number;
    redoCalls: number;
  };
  hostAPI?: {
    graph?: {
      _projectedGraphCallback?: (graph: ProjectedGraph) => void;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _triggerIpc?: (channel: string, ...args: any[]) => void;
  };
  terminalStoreAPI?: {
    addTerminal: (data: unknown) => void;
    createTerminalData: (params: { attachedToNodeId: string; terminalCount: number; title: string }) => unknown;
    getTerminalId: (data: unknown) => string;
    getShadowNodeId: (id: string) => string;
    getActiveTerminalId: () => string | null;
  };
  voiceTreeGraphView?: {
    navigationService?: {
      setLastCreatedNodeId: (id: string) => void;
    };
  };
}

export { createTestGraphDelta } from './graph-delta-fixtures';
export { getNodeCount, sendGraphDelta, waitForCytoscapeReady } from './graph-delta-actions';
export {
  exposeTerminalStoreAPI,
  selectMockProject,
  setupMockElectronAPI,
  setupTestAndNavigateToGraph,
  waitForTerminalStoreAPI,
} from './graph-delta-test-setup';
