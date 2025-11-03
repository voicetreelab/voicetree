# Phase 3: Refactor Renderer to Send Actions

## Goal
Transform the renderer from directly mutating Cytoscape to sending actions and projecting graph state.

## Current Renderer Architecture (Imperative)

```typescript
// User clicks canvas
onContextMenu() {
  // Direct mutation via IPC
  electronAPI.createStandaloneNode()

  // Waits for file watcher to add node
  // FileEventManager detects change
  // GraphMutator.addNode() updates Cytoscape
}

// User edits node
onNodeEdit(nodeId, newContent) {
  // Direct mutation via IPC
  electronAPI.saveFileContent(nodeId, newContent)

  // Waits for file watcher
  // FileEventManager updates Cytoscape
}
```

**Problems:**
- No optimistic updates (UI waits for FS → watcher → render cycle)
- State is in Cytoscape (imperative DOM mutations)
- Can't implement undo/redo
- Hard to test

## New Renderer Architecture (Functional)

```typescript
// User clicks canvas
onContextMenu() {
  const action: CreateNode = {
    type: 'CreateNode',
    nodeId: generateId(),
    content: '# New Node',
    position: some({ x, y })
  }

  // Optimistic update (optional)
  optimisticallyApplyAction(action)

  // Send action to main
  electronAPI.graph.createNode(action)
}

// Subscribe to graph broadcasts
electronAPI.on('graph:stateChanged', (graph: Graph) => {
  const elements = projectToCytoscape(graph)
  reconcileCytoscape(elements)
})
```

**Benefits:**
- Optimistic updates (instant UI feedback)
- Single source of truth (Graph in main process)
- Undo/redo possible (action log)
- Testable (pure projection)

## Files to Modify/Create

### 1. Electron API Preload

**File:** `electron/preload.ts` (modify)

Add new graph API methods:

```typescript
const electronAPI = {
  // ... existing methods

  // New functional graph API
  graph: {
    createNode: (action: CreateNode) =>
      ipcRenderer.invoke('graph:createNode', action),

    updateNode: (action: UpdateNode) =>
      ipcRenderer.invoke('graph:updateNode', action),

    deleteNode: (action: DeleteNode) =>
      ipcRenderer.invoke('graph:deleteNode', action),

    getState: () =>
      ipcRenderer.invoke('graph:getState'),

    // Subscribe to state changes
    onStateChanged: (callback: (graph: Graph) => void) =>
      ipcRenderer.on('graph:stateChanged', (event, graph) => callback(graph))
  }
}
```

### 2. Graph State Manager (Renderer)

**File:** `src/graph-core/functional/GraphStateManager.ts`

Manages graph state subscription and projection in renderer.

```typescript
import { projectToCytoscape } from './project-to-cytoscape'
import type { Graph, CytoscapeElements } from './types'
import type { CytoscapeCore } from '../graphviz/CytoscapeCore'

export class GraphStateManager {
  private cy: CytoscapeCore
  private currentGraph: Graph | null = null

  constructor(cy: CytoscapeCore) {
    this.cy = cy
    this.subscribeToGraphChanges()
  }

  private subscribeToGraphChanges() {
    window.electronAPI.graph.onStateChanged((graph: Graph) => {
      this.currentGraph = graph
      this.renderGraph(graph)
    })
  }

  private renderGraph(graph: Graph) {
    // Pure projection
    const elements = projectToCytoscape(graph)

    // Idempotent reconciliation
    this.reconcileCytoscape(elements)
  }

  private reconcileCytoscape(elements: CytoscapeElements) {
    this.cy.batch(() => {
      // Add/update nodes
      elements.nodes.forEach(nodeElem => {
        const existing = this.cy.getElementById(nodeElem.data.id)

        if (existing.length > 0) {
          // Update if data changed
          const currentData = existing.data()
          if (this.hasDataChanged(currentData, nodeElem.data)) {
            existing.data(nodeElem.data)
          }
        } else {
          // Add new node
          this.cy.add({ group: 'nodes', ...nodeElem })
        }
      })

      // Add/update edges
      elements.edges.forEach(edgeElem => {
        const existing = this.cy.getElementById(edgeElem.data.id)

        if (existing.length === 0) {
          this.cy.add({ group: 'edges', ...edgeElem })
        }
      })

      // Remove nodes not in graph
      this.cy.nodes().forEach(node => {
        const nodeExists = elements.nodes.some(e => e.data.id === node.id())
        if (!nodeExists) {
          node.remove()
        }
      })

      // Remove edges not in graph
      this.cy.edges().forEach(edge => {
        const edgeExists = elements.edges.some(e => e.data.id === edge.id())
        if (!edgeExists) {
          edge.remove()
        }
      })
    })
  }

  private hasDataChanged(current: any, next: any): boolean {
    return JSON.stringify(current) !== JSON.stringify(next)
  }

  getCurrentGraph(): Graph | null {
    return this.currentGraph
  }
}
```

### 3. Action Creators

**File:** `src/graph-core/functional/action-creators.ts`

Helper functions to create well-formed actions.

```typescript
import * as O from 'fp-ts/Option'
import type { CreateNode, UpdateNode, DeleteNode, Position } from './types'

export function createCreateNodeAction(
  nodeId: string,
  content: string,
  position?: Position
): CreateNode {
  return {
    type: 'CreateNode',
    nodeId,
    content,
    position: position ? O.some(position) : O.none
  }
}

export function createUpdateNodeAction(
  nodeId: string,
  content: string
): UpdateNode {
  return {
    type: 'UpdateNode',
    nodeId,
    content
  }
}

export function createDeleteNodeAction(nodeId: string): DeleteNode {
  return {
    type: 'DeleteNode',
    nodeId
  }
}
```

### 4. Refactor VoiceTreeGraphView

**File:** `src/views/VoiceTreeGraphView.ts` (modify)

Replace direct mutations with action dispatch.

```typescript
import { GraphStateManager } from '../graph-core/functional/GraphStateManager'
import {
  createCreateNodeAction,
  createUpdateNodeAction,
  createDeleteNodeAction
} from '../graph-core/functional/action-creators'

export class VoiceTreeGraphView {
  private cy: CytoscapeCore
  private graphStateManager: GraphStateManager
  // ... other managers

  constructor(...) {
    this.setupCytoscape()

    // Initialize graph state manager
    this.graphStateManager = new GraphStateManager(this.cy)

    this.setupActionHandlers()
  }

  private setupActionHandlers() {
    // CONTEXT MENU: Add node
    this.cy.on('cxttap', async (event) => {
      if (event.target === this.cy) {
        const nodeId = await this.generateNodeId()
        const position = { x: event.position.x, y: event.position.y }

        const action = createCreateNodeAction(
          nodeId,
          '# New Node',
          position
        )

        // Optimistic update (optional)
        this.optimisticallyAddNode(action)

        // Send to main
        await window.electronAPI.graph.createNode(action)
      }
    })

    // NODE TAP: Open editor
    this.cy.on('tap', 'node', (event) => {
      const nodeId = event.target.id()
      const currentGraph = this.graphStateManager.getCurrentGraph()

      if (currentGraph) {
        const node = currentGraph.nodes[nodeId]
        this.openEditorForNode(nodeId, node.content)
      }
    })

    // DELETE NODE
    this.cy.on('remove', 'node', async (event) => {
      const nodeId = event.target.id()
      const action = createDeleteNodeAction(nodeId)

      // Already removed from UI, just persist
      await window.electronAPI.graph.deleteNode(action)
    })
  }

  private openEditorForNode(nodeId: string, content: string) {
    const editor = this.floatingWindowManager.createFloatingEditor(nodeId, content)

    // On save, send update action
    editor.onSave(async (newContent: string) => {
      const action = createUpdateNodeAction(nodeId, newContent)

      // Optimistic update
      this.optimisticallyUpdateNode(action)

      // Send to main
      await window.electronAPI.graph.updateNode(action)
    })
  }

  // Optional: Optimistic updates for instant feedback
  private optimisticallyAddNode(action: CreateNode) {
    this.cy.add({
      group: 'nodes',
      data: {
        id: action.nodeId,
        label: 'New Node',
        content: action.content
      },
      position: O.isSome(action.position) ? action.position.value : undefined
    })
  }

  private optimisticallyUpdateNode(action: UpdateNode) {
    const node = this.cy.getElementById(action.nodeId)
    if (node.length > 0) {
      const title = extractTitle(action.content)
      node.data('label', title)
      node.data('content', action.content)
    }
  }
}
```

### 5. Remove Legacy Code

Once functional architecture is working:

**Remove:**
- `FileEventManager.ts` - Replaced by GraphStateManager
- `GraphMutator.ts` - Replaced by projectToCytoscape + reconciliation
- Direct IPC calls (`create-standalone-node`, `save-file-content`, etc.)

**Keep:**
- `CytoscapeCore.ts` - Still needed as rendering engine
- `FloatingWindowManager.ts` - Still needed for editors
- Other UI managers (HotkeyManager, SearchService, etc.)

## Data Flow Comparison

### Old (Imperative)
```
User clicks
  → IPC: create-standalone-node
  → MarkdownNodeManager writes file
  → Chokidar detects
  → FileWatchManager.onFileAdded
  → FileEventManager parses + caches
  → GraphMutator.addNode
  → Cytoscape.add()
```

### New (Functional)
```
User clicks
  → CreateNode action
  → Optimistic: cy.add() (instant feedback)
  → IPC: graph.createNode(action)
  → apply_graph_updates(graph, action)
  → DBIO: write file
  → Chokidar detects
  → apply_db_updates_to_graph(graph, fsUpdate)
  → UIIO: broadcast(graph)
  → GraphStateManager receives graph
  → projectToCytoscape(graph)
  → reconcileCytoscape(elements) - idempotent, fixes any optimistic errors
```

## Testing Strategy

### Unit Tests

**File:** `tests/unit/graph-core/functional/GraphStateManager.test.ts`

```typescript
describe('GraphStateManager', () => {
  it('should reconcile cytoscape with graph state', () => {
    const mockCy = createMockCytoscape()
    const manager = new GraphStateManager(mockCy)

    const graph: Graph = {
      nodes: {
        '1': { id: '1', title: 'Node 1', content: '# Node 1', summary: '', color: none }
      },
      edges: {}
    }

    manager.renderGraph(graph)

    expect(mockCy.nodes()).toHaveLength(1)
    expect(mockCy.getElementById('1').data('label')).toBe('Node 1')
  })

  it('should be idempotent - rendering same graph twice has no effect', () => {
    const mockCy = createMockCytoscape()
    const manager = new GraphStateManager(mockCy)

    const graph: Graph = { /* ... */ }

    manager.renderGraph(graph)
    const state1 = mockCy.json()

    manager.renderGraph(graph)
    const state2 = mockCy.json()

    expect(state1).toEqual(state2)
  })
})
```

### Integration Tests

**File:** `tests/e2e/full-electron/functional-graph-flow.spec.ts`

Use Playwright to test the full flow:
1. User creates node
2. Verify optimistic update
3. Verify file written to disk
4. Verify final reconciliation
5. Edit node in external editor
6. Verify graph updates in UI

## Migration Strategy

### Step 1: Parallel Implementation
- Add GraphStateManager alongside FileEventManager
- Use feature flag to enable functional architecture
- Test thoroughly with both systems running

### Step 2: Gradual Migration
- Migrate create node action first
- Then update node
- Then delete node
- Keep legacy system as fallback

### Step 3: Remove Legacy
- Once all actions migrated and stable
- Remove FileEventManager, GraphMutator
- Remove old IPC handlers
- Clean up dead code

## Success Criteria

- ✓ All user actions go through NodeAction types
- ✓ Renderer never directly mutates Cytoscape data (only positions/UI state)
- ✓ Graph state comes from main process broadcasts
- ✓ projectToCytoscape is used for all rendering
- ✓ reconcileCytoscape is idempotent
- ✓ Optimistic updates provide instant feedback
- ✓ All e2e tests pass
- ✓ No regressions in functionality

## Future Enhancements

After Phase 3 is complete:

1. **Undo/Redo**
   - Keep action log in main process
   - Implement time-travel by replaying actions

2. **Conflict Resolution**
   - Detect conflicts between optimistic updates and server state
   - Resolve automatically or prompt user

3. **Offline Support**
   - Queue actions when filesystem unavailable
   - Replay when connection restored

4. **Performance Optimization**
   - Batch reconciliation updates
   - Virtual rendering for large graphs
   - Incremental projection (diff-based)

5. **Developer Tools**
   - Action logger
   - State inspector
   - Time-travel debugger
