# Graph Layout Module Architecture

## Overview
This module provides a modular, testable, and framework-agnostic positioning system for graph nodes. The design separates pure positioning algorithms from Cytoscape-specific integration.

## Core Architecture

### Directory Structure
```
webapp/src/graph-core/graphviz/layout/
├── ARCHITECTURE.md           (this file)
├── types.ts                   (shared interfaces)
├── LayoutManager.ts           (Cytoscape integration layer)
├── strategies/                (positioning algorithms)
│   ├── PositioningStrategy.ts (base interface)
│   ├── SimpleRadialStrategy.ts
│   └── SeedParkRelaxStrategy.ts
└── utils/                     (shared utilities)
    ├── overlap.ts
    └── geometry.ts
```

## API Design

### Core Types
```typescript
// types.ts
interface NodeInfo {
  id: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  linkedNodeIds: string[];  // For parent/child relationships
}

interface PositioningContext {
  nodes: NodeInfo[];        // All existing nodes
  newNodes: NodeInfo[];     // Nodes to position
  bounds?: { width: number; height: number };  // Canvas bounds
}

interface PositioningResult {
  positions: Map<string, { x: number; y: number }>;
}

// Base interface for positioning strategies
interface PositioningStrategy {
  name: string;
  position(context: PositioningContext): PositioningResult;
}
```

### Layout Manager (Cytoscape Integration)
```typescript
// LayoutManager.ts
export class LayoutManager {
  private strategy: PositioningStrategy;

  constructor(strategy: PositioningStrategy = new SeedParkRelaxStrategy()) {
    this.strategy = strategy;
  }

  applyLayout(cy: Core, newNodeIds: string[]): void {
    // 1. Extract context from Cytoscape
    const context = this.extractContext(cy, newNodeIds);

    // 2. Run pure positioning algorithm
    const result = this.strategy.position(context);

    // 3. Apply results back to Cytoscape
    this.applyPositions(cy, result);
  }

  private extractContext(cy: Core, newNodeIds: string[]): PositioningContext {
    // Convert Cytoscape nodes to NodeInfo
    const allNodes = cy.nodes();
    const nodes = allNodes.map(node => ({
      id: node.id(),
      position: node.position(),
      size: this.getNodeSize(node),
      linkedNodeIds: node.data('linkedNodeIds') || []
    }));

    const newNodes = nodes.filter(n => newNodeIds.includes(n.id));
    const existingNodes = nodes.filter(n => !newNodeIds.includes(n.id));

    return {
      nodes: existingNodes,
      newNodes: newNodes,
      bounds: { width: cy.width(), height: cy.height() }
    };
  }

  private applyPositions(cy: Core, result: PositioningResult): void {
    result.positions.forEach((pos, nodeId) => {
      cy.$id(nodeId).position(pos);
    });
  }
}
```

## Positioning Strategies

### 1. Simple Radial Strategy (Current Implementation)
Places nodes at optimal angles around parent nodes, avoiding existing edges.

```typescript
export class SimpleRadialStrategy implements PositioningStrategy {
  name = 'simple-radial';

  position(context: PositioningContext): PositioningResult {
    // Port of existing findOptimalPosition logic
    // Works with plain data, no Cytoscape dependency
  }
}
```

### 2. Seed-Park-Relax Strategy (Advanced)
Three-phase algorithm for overlap-free positioning with good edge lengths.

```typescript
export class SeedParkRelaxStrategy implements PositioningStrategy {
  name = 'seed-park-relax';

  private config = {
    targetLength: 140,
    edgeLenTolerance: 0.3,
    microRelaxIters: 12,
    springK: 1.0,
    repelK: 0.5,
    stepSize: 0.25,
    localRadiusMult: 3
  };

  position(context: PositioningContext): PositioningResult {
    const positions = new Map<string, { x: number; y: number }>();

    for (const node of context.newNodes) {
      // Phase 1: SEED - Find initial position
      const seedPos = this.seed(node, context);

      // Phase 2: PARK - Find nearest non-overlapping spot
      const parkedPos = this.park(seedPos, node, context);

      // Phase 3: MICRO-RELAX - Local settling
      const relaxedPos = this.microRelax(parkedPos, node, context);

      positions.set(node.id, relaxedPos);
    }

    return { positions };
  }

  private seed(node: NodeInfo, context: PositioningContext): Position {
    // Find largest angular gap from parent
  }

  private park(seedPos: Position, node: NodeInfo, context: PositioningContext): Position {
    // Spiral search for non-overlapping position
  }

  private microRelax(pos: Position, node: NodeInfo, context: PositioningContext): Position {
    // Run physics simulation for local settling
  }
}
```

## Key Design Principles

### 1. **Pure Functions**
Positioning algorithms work with plain data structures, not framework-specific objects.

### 2. **Strategy Pattern**
Easy to swap algorithms without changing integration code.

### 3. **Clear Boundaries**
- `LayoutManager`: Handles framework integration (Cytoscape, D3, etc.)
- `Strategy` classes: Pure positioning logic
- `Utils`: Shared geometry and overlap detection

### 4. **Testability**
Strategies can be unit tested with mock data, no Cytoscape required.

```typescript
// Example test
describe('SeedParkRelaxStrategy', () => {
  it('should position nodes without overlap', () => {
    const context: PositioningContext = {
      nodes: [
        { id: '1', position: { x: 0, y: 0 }, size: { width: 40, height: 40 }, linkedNodeIds: [] }
      ],
      newNodes: [
        { id: '2', position: { x: 0, y: 0 }, size: { width: 40, height: 40 }, linkedNodeIds: ['1'] }
      ]
    };

    const strategy = new SeedParkRelaxStrategy();
    const result = strategy.position(context);

    expect(result.positions.get('2')).toBeDefined();
    expect(distance(result.positions.get('2'), { x: 0, y: 0 })).toBeGreaterThan(40);
  });
});
```

## Implementation Phases

### Phase 1: Basic Structure ✅
- [x] Create types and interfaces
- [x] Define LayoutManager API
- [x] Plan strategy pattern

### Phase 2: Port Existing Logic
- [ ] Create SimpleRadialStrategy from current findOptimalPosition
- [ ] Implement LayoutManager with Cytoscape integration
- [ ] Wire up in test-runner.ts

### Phase 3: Advanced Algorithm
- [ ] Implement overlap detection utilities
- [ ] Create SeedParkRelaxStrategy
- [ ] Add micro-relaxation physics

### Phase 4: Optimization
- [ ] Add spatial indexing for O(log n) overlap checks
- [ ] Cache node bounds
- [ ] Batch position updates

## Usage Example

```typescript
// In test-runner.ts or any Cytoscape integration
import { LayoutManager, SeedParkRelaxStrategy } from './graph-core/graphviz/layout';

// Initialize with strategy
const layoutManager = new LayoutManager(new SeedParkRelaxStrategy());

// After adding new nodes to Cytoscape
const newNodeIds = ['node1', 'node2', 'node3'];
layoutManager.applyLayout(cy, newNodeIds);

// Or use simple radial for performance
const simpleLayout = new LayoutManager(new SimpleRadialStrategy());
simpleLayout.applyLayout(cy, orphanNodes);
```

## Benefits

1. **Portability**: Same algorithms work with any graph library
2. **Testability**: Pure functions with no side effects
3. **Extensibility**: Easy to add new strategies
4. **Performance**: Can optimize algorithms independently
5. **Maintainability**: Clear separation of concerns

## Future Extensions

- **Hierarchical Layout**: Tree-based positioning
- **Force-Directed Layout**: Full physics simulation
- **Circular Layout**: Nodes in concentric circles
- **Grid Layout**: Regular grid positioning
- **Custom Constraints**: User-defined positioning rules