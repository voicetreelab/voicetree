import type { ElectronApplication, Page } from '@playwright/test';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { HostAPI } from '@/shell/hostApi';

export interface RealFolderFixtures {
  electronApp: ElectronApplication;
  appWindow: Page;
}

export interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  hostAPI?: HostAPI;
  testHelpers?: {
    createTerminal: (nodeId: string) => void;
    addNodeAtPosition: (position: GraphPosition) => Promise<void>;
    getEditorInstance: (windowId: string) => { getValue: () => string; setValue: (content: string) => void } | undefined;
  };
}

export interface EdgeConnection {
  source: string;
  target: string;
}

export interface GraphState {
  nodeCount: number;
  edgeCount: number;
  nodeLabels: string[];
  edges: EdgeConnection[];
}

export interface EdgeVisibility {
  visible: boolean;
  reason?: string;
  opacity?: number;
  width?: number;
  color?: string;
  edgeCount?: number;
}

export interface EdgeLabelCheck {
  hasLabels?: boolean;
  reason?: string;
  totalEdges?: number;
  edgesWithDataLabels?: number;
  sampleLabel?: string;
  styleLabelValue?: string;
  fontSize?: string;
}

export interface GraphPosition {
  x: number;
  y: number;
}

export interface ViewportState {
  zoom: number;
  pan: GraphPosition;
}

export interface BulkLoadState {
  nodeCount: number;
  yCoords: number[];
  uniqueYCount: number;
  allAtZero: boolean;
  samplePositions: Array<{ id: string; x: number; y: number }>;
}

export interface IncrementalLayoutState {
  totalNodes: number;
  newNodePositions: Array<{ id: string; x: number; y: number }>;
  allNewAtZero: boolean;
  uniqueYLevels: number;
  overlapCount: number;
}

export interface ComplexLinksGraphState {
  nodeExists: boolean;
  connectedEdgeCount: number;
  connections: EdgeConnection[];
}

export interface SelectionResult {
  totalNodes: number;
  selectedCount: number;
  selectedIds: string[];
  selectedLabels: string[];
}

export interface NodePositionCheck {
  success: boolean;
  message: string;
  nodeId: string | null;
  distance?: number;
}

export interface NodeSizeData {
  all: Array<{
    id: string;
    label: string;
    degree: number;
    width: number;
    height: number;
    borderWidth: number;
  }>;
  lowest: {
    id: string;
    label: string;
    degree: number;
    width: number;
    height: number;
    borderWidth: number;
  };
  highest: {
    id: string;
    label: string;
    degree: number;
    width: number;
    height: number;
    borderWidth: number;
  };
}

export interface GraphSummary {
  nodeCount: number;
  nodeLabels: string[];
}

export interface SearchTargetNode {
  id: string;
  label: string;
}

export interface StopFileWatchingResult {
  success: boolean;
  error?: string;
}
