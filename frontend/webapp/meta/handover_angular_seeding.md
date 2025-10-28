# Angular Position Seeding Implementation Plan

## Overview

Implement angular position seeding for graph nodes to provide good initial positions before cola.js force-directed layout runs. Nodes spawn from their parent at calculated angles using recursive subdivision (0°, 90°, 180°, 270° → then midpoints → ...).

## Visual Goal

```
        ○ (0°)
        ↑
   ○ ← root → ○
 (270°)  ↓  (90°)
        ○ (180°)
```

For 5+ nodes, fill in 45°, 135°, 225°, 315°, then continue subdividing.

Children constrained to `parentAngle ± 45°` cone.

## Architecture

### 1. New Module: `src/graph-core/graphviz/layout/angularPositionSeeding.ts`

#### Function: `calculateChildAngle(childIndex: number, parentAngle?: number): number`

**Purpose**: Calculate spawn angle for the Nth child of a parent.

**Algorithm - Recursive Subdivision**:
```
Level 0 (0-3):   [0°, 90°, 180°, 270°]           // quarters
Level 1 (4-7):   [45°, 135°, 225°, 315°]         // add midpoints (eighths)
Level 2 (8-15):  [22.5°, 67.5°, 112.5°, ...]     // subdivide again (sixteenths)
...
```

**Pseudocode**:
```typescript
function calculateChildAngle(childIndex: number, parentAngle?: number): number {
  // Determine angle range
  const range = parentAngle !== undefined
    ? { min: parentAngle - 45, max: parentAngle + 45 }  // 90° cone for children
    : { min: 0, max: 360 };                               // full circle for roots

  const rangeSize = range.max - range.min;

  // Recursive subdivision logic
  // Start with 4 base angles (quarters of the range)
  // Then add midpoints between all existing angles
  // Continue subdividing until we have enough angles

  const angle = computeSubdividedAngle(childIndex, rangeSize);

  return (range.min + angle) % 360;
}

function computeSubdividedAngle(index: number, rangeSize: number): number {
  // Implementation details:
  // Level 0: [0, 0.25, 0.5, 0.75] * rangeSize
  // Level 1: insert midpoints [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875] * rangeSize
  // Level 2: insert midpoints again...

  // Can use bit manipulation or explicit level calculation
  // For index i:
  //   - Determine level: level = floor(log2((i+4)/4))
  //   - Determine position within level
  //   - Calculate fractional position in [0,1]
  //   - Multiply by rangeSize

  // Simpler approach: build array of normalized positions [0,1] on-demand
  const positions = buildSubdividedPositions(index + 1); // need (index+1) positions
  return positions[index] * rangeSize;
}

function buildSubdividedPositions(count: number): number[] {
  // Start with [0, 0.25, 0.5, 0.75]
  let positions = [0, 0.25, 0.5, 0.75];

  // Keep subdividing until we have enough
  while (positions.length < count) {
    const newPositions = [];
    for (let i = 0; i < positions.length; i++) {
      newPositions.push(positions[i]);
      // Add midpoint before next position
      const next = positions[(i + 1) % positions.length];
      const midpoint = (positions[i] + next) / 2;
      if (midpoint > positions[i]) { // avoid wrapping issues
        newPositions.push(midpoint);
      }
    }
    positions = newPositions.sort((a, b) => a - b);
  }

  return positions;
}
```

**Note**: This is pseudocode. The actual implementation may use a more efficient algorithm (e.g., bit manipulation or formula-based).

#### Function: `polarToCartesian(angle: number, radius: number): { x: number; y: number }`

**Purpose**: Convert polar coordinates to cartesian offset.

**Implementation**:
```typescript
export function polarToCartesian(angle: number, radius: number): { x: number; y: number } {
  const radians = (angle * Math.PI) / 180;
  return {
    x: radius * Math.cos(radians),
    y: radius * Math.sin(radians)
  };
}
```

**Note**: Cytoscape uses standard cartesian coordinates (0° = right/east, 90° = up/north).

### 2. Update `GraphMutator.calculateInitialPosition()`

**Location**: `src/graph-core/mutation/GraphMutator.ts:194`

**Current behavior**: Places new node at `(parentX + 100, parentY)`.

**New behavior**: Calculate angular position based on sibling count.

**Implementation**:
```typescript
private calculateInitialPosition(parentId?: string): { x: number; y: number } {
  const SPAWN_RADIUS = 200; // pixels from parent

  if (parentId) {
    const parentNode = this.cy.getElementById(parentId);
    if (parentNode.length > 0) {
      const parentPos = parentNode.position();
      const parentAngle = parentNode.data('spawnAngle'); // may be undefined

      // Get sibling count (children of same parent)
      // childIndex = current children count (this node will be N+1th child)
      const childIndex = parentNode.children().length;

      // Calculate angle for this child
      const angle = calculateChildAngle(childIndex, parentAngle);

      // Convert to cartesian offset
      const offset = polarToCartesian(angle, SPAWN_RADIUS);

      return {
        x: parentPos.x + offset.x,
        y: parentPos.y + offset.y
      };
    }
  }

  // No parent - root node at origin
  return { x: 0, y: 0 };
}
```

### 3. Store Spawn Angle on Node

**Location**: `src/graph-core/mutation/GraphMutator.ts` in `addNode()` method

**After node creation** (line ~55), store the calculated angle:
```typescript
// Calculate initial position to minimize animation thrashing
const initialPosition = skipPositioning
  ? { x: 0, y: 0 }
  : this.calculateInitialPosition(parentId);

// Calculate and store spawn angle for this node (for its children to reference)
let spawnAngle: number | undefined;
if (!skipPositioning && parentId) {
  const parentNode = this.cy.getElementById(parentId);
  if (parentNode.length > 0) {
    const parentAngle = parentNode.data('spawnAngle');
    const childIndex = parentNode.children().length;
    spawnAngle = calculateChildAngle(childIndex, parentAngle);
  }
}

// Use batch to ensure node and ghost edge are added atomically
let node: NodeSingular;
this.cy.batch(() => {
  // Create node with all data
  node = this.cy.add({
    data: {
      id: nodeId,
      label,
      linkedNodeIds,
      parentId,
      ...(color && { color }),
      ...(spawnAngle !== undefined && { spawnAngle })  // store angle
    },
    position: initialPosition
  });

  // ... rest of addNode logic
});
```

### 4. Bulk Position Seeding

**Location**: After `bulkAddNodes()` call in `useFileWatcher.ts:88`

**Add new phase** before layout runs:
```typescript
// Use GraphMutator to bulk add nodes and edges
const createdNodes = graphMutator.bulkAddNodes(nodesData);

// PHASE 3: Seed positions via tree traversal
seedBulkPositions(cy, createdNodes);

const allNodeIds = createdNodes.map(node => node.id());
```

**New function to add**:
```typescript
function seedBulkPositions(cy: Core, nodes: NodeSingular[]): void {
  // Build parent -> children map
  const childrenMap = new Map<string, NodeSingular[]>();

  nodes.forEach(node => {
    const parentId = node.data('parentId');
    if (parentId) {
      if (!childrenMap.has(parentId)) {
        childrenMap.set(parentId, []);
      }
      childrenMap.get(parentId)!.push(node);
    }
  });

  // Find roots (nodes with no parentId or parentId === GHOST_ROOT_ID)
  const roots = nodes.filter(n => !n.data('parentId'));

  // Pre-order traversal from each root
  roots.forEach((root, index) => {
    // Position root nodes around origin
    const angle = calculateChildAngle(index, undefined);
    const pos = polarToCartesian(angle, 200);
    root.position({ x: pos.x, y: pos.y });
    root.data('spawnAngle', angle);

    // Recursively position children
    positionChildren(root, childrenMap);
  });
}

function positionChildren(parent: NodeSingular, childrenMap: Map<string, NodeSingular[]>): void {
  const parentId = parent.id();
  const children = childrenMap.get(parentId) || [];

  if (children.length === 0) return;

  const parentPos = parent.position();
  const parentAngle = parent.data('spawnAngle');

  children.forEach((child, index) => {
    // Calculate angle for this child
    const angle = calculateChildAngle(index, parentAngle);

    // Calculate position relative to parent
    const offset = polarToCartesian(angle, 200);
    child.position({
      x: parentPos.x + offset.x,
      y: parentPos.y + offset.y
    });

    // Store angle on child
    child.data('spawnAngle', angle);

    // Recursively position this child's children
    positionChildren(child, childrenMap);
  });
}
```

**Import statement to add**:
```typescript
import { calculateChildAngle, polarToCartesian } from '@/graph-core/graphviz/layout/angularPositionSeeding';
```

## Edge Cases & Constraints

### 1. Root Nodes (No Parent)
- **Constraint**: Use full 360° range
- **Position**: Relative to origin (0, 0) or viewport center
- **Multiple roots**: Each gets angle from subdivision of full circle

### 2. Children Angle Constraint
- **Constraint**: Children spawn within `parentAngle ± 45°` (90° cone)
- **Rationale**: Prevents children from wrapping around and keeps tree visually hierarchical
- **Example**: If parent spawned at 90° (north), children spawn between 45° and 135°

### 3. Ghost Root Node
- **Issue**: There's a `GHOST_ROOT_ID` node that connects orphans
- **Solution**: Exclude ghost root from angle calculations
- **Check**: `node.data('isGhostRoot') === true` or `node.id() === GHOST_ROOT_ID`

### 4. Existing Positions
- **Bulk load**: All nodes start at (0, 0) due to `skipPositioning: true`
- **Incremental**: `calculateInitialPosition()` is called immediately
- **Rule**: Never recalculate position for nodes that already have non-zero positions

### 5. Node Already Has Position
- **Check**: `node.position().x !== 0 || node.position().y !== 0`
- **Action**: Skip position calculation

### 6. Parent Not Found
- **Scenario**: parentId references non-existent node
- **Action**: Fall back to origin (0, 0) or viewport center

### 7. Cytoscape's `.children()` API
- **Note**: `parentNode.children()` returns compound children, NOT edge-based children
- **Our case**: We use `parentId` in node data, not Cytoscape compounds
- **Solution**: Count children by filtering: `cy.nodes().filter(n => n.data('parentId') === parentId).length`

### 8. Spawn Radius
- **Current**: Fixed at 200px
- **Future**: Could scale based on tree depth or node degree
- **Constant**: Define `SPAWN_RADIUS = 200` at module level for easy tuning

## Implementation Checklist

- [ ] Create `src/graph-core/graphviz/layout/angularPositionSeeding.ts`
  - [ ] Implement `calculateChildAngle(childIndex, parentAngle?)`
  - [ ] Implement `polarToCartesian(angle, radius)`
  - [ ] Add unit tests for angle subdivision logic

- [ ] Update `GraphMutator.calculateInitialPosition()`
  - [ ] Replace `parentPos.x + 100` with angular calculation
  - [ ] Handle parent angle constraint (± 45°)
  - [ ] Fix sibling counting: use filter, not `.children()`

- [ ] Store spawn angle on nodes
  - [ ] Add `spawnAngle` to node data in `addNode()`
  - [ ] Calculate angle before position

- [ ] Add bulk position seeding
  - [ ] Create `seedBulkPositions()` function in `useFileWatcher.ts`
  - [ ] Create `positionChildren()` helper
  - [ ] Call after `bulkAddNodes()` at line 88

- [ ] Test cases
  - [ ] Single root with 1-4 children (should be 0°, 90°, 180°, 270°)
  - [ ] Single root with 5-8 children (should add 45°, 135°, 225°, 315°)
  - [ ] Multi-level tree (verify angle constraints propagate)
  - [ ] Multiple roots (should each get separate angles)
  - [ ] Incremental node addition (verify sibling count is correct)

## Constants & Configuration

```typescript
// In angularPositionSeeding.ts
export const SPAWN_RADIUS = 200; // pixels from parent
export const CHILD_ANGLE_CONE = 90; // degrees (± 45° from parent)
```

## Testing Strategy

### Unit Tests (angularPositionSeeding.test.ts)

```typescript
describe('calculateChildAngle', () => {
  it('should return base angles for first 4 children', () => {
    expect(calculateChildAngle(0)).toBe(0);
    expect(calculateChildAngle(1)).toBe(90);
    expect(calculateChildAngle(2)).toBe(180);
    expect(calculateChildAngle(3)).toBe(270);
  });

  it('should add midpoints for children 5-8', () => {
    expect(calculateChildAngle(4)).toBe(45);
    expect(calculateChildAngle(5)).toBe(135);
    expect(calculateChildAngle(6)).toBe(225);
    expect(calculateChildAngle(7)).toBe(315);
  });

  it('should constrain to parent angle ± 45°', () => {
    const angle = calculateChildAngle(0, 90); // parent at north
    expect(angle).toBeGreaterThanOrEqual(45);
    expect(angle).toBeLessThanOrEqual(135);
  });
});

describe('polarToCartesian', () => {
  it('should convert 0° to (radius, 0)', () => {
    expect(polarToCartesian(0, 100)).toEqual({ x: 100, y: 0 });
  });

  it('should convert 90° to (0, radius)', () => {
    const result = polarToCartesian(90, 100);
    expect(result.x).toBeCloseTo(0);
    expect(result.y).toBeCloseTo(100);
  });
});
```

### E2E Tests

- **Test**: Load markdown tree with 8 nodes (1 root, 7 children)
- **Verify**: Children positioned at expected angles
- **Test**: Add 9th child via file watcher
- **Verify**: Positioned at next subdivision angle

## Notes

- This seeding provides good starting positions for cola.js, not final positions
- Cola will refine positions based on edge lengths and overlap avoidance
- The angular seeding reduces layout "thrashing" and provides more predictable initial positions
- For very large trees (100+ nodes), cola may need more iterations to settle

## Future Enhancements

1. **Adaptive radius**: Scale spawn radius based on node degree or tree depth
2. **Parent-child edge direction**: Consider edge direction (some edges may be reversed)
3. **Compound nodes**: If we ever use Cytoscape compounds, update sibling counting logic
4. **Animation**: Smooth transition when adding new nodes (already handled by cola?)
5. **Configurable base angles**: Allow 3, 4, or 6 base angles instead of hardcoded 4
