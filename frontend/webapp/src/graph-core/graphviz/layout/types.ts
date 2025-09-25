// Core types for the positioning system

export interface Position {
  x: number;
  y: number;
}

export interface NodeSize {
  width: number;
  height: number;
}

export interface NodeInfo {
  id: string;
  position: Position;
  size: NodeSize;
  linkedNodeIds: string[];
}

export interface PositioningContext {
  nodes: NodeInfo[];        // All existing nodes
  newNodes: NodeInfo[];     // Nodes to position
  bounds?: { width: number; height: number };
}

export interface PositioningResult {
  positions: Map<string, Position>;
}

export interface PositioningStrategy {
  name: string;
  position(context: PositioningContext): PositioningResult;
}

export interface StrategyConfig {
  targetLength?: number;
  edgeLenTolerance?: number;
  microRelaxIters?: number;
  springK?: number;
  repelK?: number;
  stepSize?: number;
  localRadiusMult?: number;
}