# Phase 2: Wire Up Event Handlers

## Goal
Connect the pure functions to the IPC event system, creating the functional data flow between renderer, main process, and filesystem.

## What We're Building

Three sets of event handlers that orchestrate the pure functions with side effects.

## Architecture Overview

```
Renderer → IPC → handleUserAction → apply_graph_updates → (Graph, DBIO) → Update cache + Execute effect
                                                                ↓
                                                          Write to FS
                                                                ↓
                                                          Chokidar detects
                                                                ↓
FileWatcher → handleFSEvent → apply_db_updates_to_graph → (Graph, UIIO) → Update cache + Execute effect
                                                                ↓
                                                          Broadcast to renderer
```

## Files to Create

### 1. IPC Handlers for User Actions

**File:** `electron/handlers/ipc-graph-handlers.ts`

```typescript
import { ipcMain } from 'electron'
import { apply_graph_updates } from '../../src/graph-core/functional/apply-graph-updates'
import type { Graph, CreateNode, UpdateNode, DeleteNode } from '../../src/graph-core/functional/types'

export function setupGraphIpcHandlers(
  getGraph: () => Graph,
  setGraph: (graph: Graph) => void
) {
  // CREATE NODE
  ipcMain.handle('graph:createNode', async (event, action: CreateNode) => {
    const currentGraph = getGraph()
    const [newGraph, dbEffect] = apply_graph_updates(currentGraph, action)

    await dbEffect()          // Write to filesystem
    setGraph(newGraph)        // Update cache

    return { success: true }
  })

  // UPDATE NODE
  ipcMain.handle('graph:updateNode', async (event, action: UpdateNode) => {
    const currentGraph = getGraph()
    const [newGraph, dbEffect] = apply_graph_updates(currentGraph, action)

    await dbEffect()
    setGraph(newGraph)

    return { success: true }
  })

  // DELETE NODE
  ipcMain.handle('graph:deleteNode', async (event, action: DeleteNode) => {
    const currentGraph = getGraph()
    const [newGraph, dbEffect] = apply_graph_updates(currentGraph, action)

    await dbEffect()
    setGraph(newGraph)

    return { success: true }
  })

  // QUERY GRAPH STATE
  ipcMain.handle('graph:getState', async () => {
    return getGraph()
  })
}
```

**Key Design:**
- Uses getter/setter functions instead of direct access to `currentGraph`
- Encapsulates mutation in one place
- Returns success/error for user feedback

### 2. FileWatcher Event Handlers

**File:** `electron/handlers/file-watch-handlers.ts`

```typescript
import { apply_db_updates_to_graph } from '../../src/graph-core/functional/apply-db-updates'
import type { Graph, FSUpdate } from '../../src/graph-core/functional/types'
import type { FileData } from '../../src/providers/IMarkdownVaultProvider'

export function setupFileWatchHandlers(
  fileWatcher: FileWatchManager,
  getGraph: () => Graph,
  setGraph: (graph: Graph) => void
) {
  // FILE ADDED
  fileWatcher.onFileAdded((file: FileData) => {
    const fsUpdate: FSUpdate = {
      path: file.path,
      content: file.content,
      eventType: 'Added'
    }

    const currentGraph = getGraph()
    const [newGraph, uiEffect] = apply_db_updates_to_graph(currentGraph, fsUpdate)

    setGraph(newGraph)        // Update cache
    uiEffect()                // Broadcast to renderer
  })

  // FILE CHANGED
  fileWatcher.onFileChanged((file: FileData) => {
    const fsUpdate: FSUpdate = {
      path: file.path,
      content: file.content,
      eventType: 'Changed'
    }

    const currentGraph = getGraph()
    const [newGraph, uiEffect] = apply_db_updates_to_graph(currentGraph, fsUpdate)

    setGraph(newGraph)
    uiEffect()
  })

  // FILE DELETED
  fileWatcher.onFileDeleted((fullPath: string) => {
    const fsUpdate: FSUpdate = {
      path: fullPath,
      content: '',
      eventType: 'Deleted'
    }

    const currentGraph = getGraph()
    const [newGraph, uiEffect] = apply_db_updates_to_graph(currentGraph, fsUpdate)

    setGraph(newGraph)
    uiEffect()
  })

  // BULK FILES LOADED (initial scan)
  fileWatcher.onFilesLoaded((files: FileData[]) => {
    // For initial load, we already have the graph from loadGraphFromDisk
    // Just broadcast it to renderer
    const currentGraph = getGraph()

    // Create UI effect to broadcast initial state
    const uiEffect = () => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('graph:stateChanged', currentGraph)
    }

    uiEffect()
  })
}
```

### 3. Main Process Integration

**File:** `electron/main.ts` (modifications)

```typescript
import { app, BrowserWindow } from 'electron'
import { loadGraphFromDisk } from './graph/load-graph-from-disk'
import { setupGraphIpcHandlers } from './handlers/ipc-graph-handlers'
import { setupFileWatchHandlers } from './handlers/file-watch-handlers'
import { FileWatchManager } from './file-watch-manager'
import type { Graph } from '../src/graph-core/functional/types'

async function main() {
  await app.whenReady()

  // Create window
  const mainWindow = createWindow()

  // Get vault path (from settings or user selection)
  const vaultPath = await getVaultPath()

  // ============================================
  // PHASE 1: Initialize graph from disk
  // ============================================
  let currentGraph: Graph = await loadGraphFromDisk(vaultPath)()

  console.log(`Loaded ${Object.keys(currentGraph.nodes).length} nodes`)

  // ============================================
  // PHASE 2: Wire up event handlers
  // ============================================

  // Getter/setter for controlled access to currentGraph
  const getGraph = () => currentGraph
  const setGraph = (graph: Graph) => { currentGraph = graph }

  // Setup IPC handlers for user actions
  setupGraphIpcHandlers(getGraph, setGraph)

  // Setup file watcher handlers
  const fileWatcher = new FileWatchManager()
  setupFileWatchHandlers(fileWatcher, getGraph, setGraph)

  // Start watching
  await fileWatcher.watchDirectory(vaultPath)

  console.log('Graph event handlers ready')
}

app.on('ready', main)
```

## Implementing the DBIO and UIIO Effects

Currently our pure functions return `DBIO` and `UIIO` as stubs. Now we implement them.

### DBIO - Database/Filesystem Effects

**In:** `src/graph-core/functional/applyGraphActionsToDB.ts`

```typescript
function persistAction(action: NodeAction, vaultPath: string): DBIO<void> {
  return async () => {
    switch (action.type) {
      case 'CreateNode': {
        const filename = `${action.nodeId}.md`
        const filepath = path.join(vaultPath, filename)
        await fs.writeFile(filepath, action.content, 'utf-8')
        break
      }

      case 'UpdateNode': {
        const filename = `${action.nodeId}.md`
        const filepath = path.join(vaultPath, filename)
        await fs.writeFile(filepath, action.content, 'utf-8')
        break
      }

      case 'DeleteNode': {
        const filename = `${action.nodeId}.md`
        const filepath = path.join(vaultPath, filename)
        await fs.unlink(filepath)
        break
      }
    }
  }
}
```

**Problem:** Need vault path!

**Solution:** Curry the function:

```typescript
// Modified signature
export function apply_graph_updates(vaultPath: string) {
  return (graph: Graph, action: NodeAction): [Graph, DBIO<void>] => {
    // ... implementation uses vaultPath
  }
}

// Usage in handler:
const apply = apply_graph_updates(vaultPath)
const [newGraph, dbEffect] = apply(currentGraph, action)
```

### UIIO - UI Broadcast Effects

**In:** `src/graph-core/functional/applyFSEventToGraph.ts`

```typescript
function broadcastGraph(graph: Graph): UIIO<void> {
  return () => {
    const windows = BrowserWindow.getAllWindows()
    windows.forEach(win => {
      win.webContents.send('graph:stateChanged', graph)
    })
  }
}
```

**Problem:** Need BrowserWindow reference!

**Solution:** Inject dependency:

```typescript
// Modified signature
export function apply_db_updates_to_graph(broadcast: (graph: Graph) => void) {
  return (graph: Graph, fsUpdate: FSUpdate): [Graph, UIIO<void>] => {
    // ... implementation uses broadcast function
  }
}

// Usage in handler:
const broadcast = (g: Graph) => {
  mainWindow.webContents.send('graph:stateChanged', g)
}
const apply = apply_db_updates_to_graph(broadcast)
const [newGraph, uiEffect] = apply(currentGraph, fsUpdate)
```

## Testing Strategy

### Unit Tests

**File:** `tests/unit/electron/handlers/ipc-graph-handlers.test.ts`

```typescript
describe('setupGraphIpcHandlers', () => {
  it('should handle createNode action', async () => {
    const mockGraph: Graph = { nodes: {}, edges: {} }
    let currentGraph = mockGraph

    const getGraph = () => currentGraph
    const setGraph = (g: Graph) => { currentGraph = g }

    setupGraphIpcHandlers(getGraph, setGraph)

    const action: CreateNode = {
      type: 'CreateNode',
      nodeId: '1',
      content: '# Test',
      position: none
    }

    const result = await ipcMain.invoke('graph:createNode', action)

    expect(result.success).toBe(true)
    expect(Object.keys(currentGraph.nodes)).toContain('1')
  })
})
```

### Integration Tests

**File:** `tests/integration/electron/full-cycle.test.ts`

Test the full cycle:
1. User action → IPC → Update graph → Write to FS
2. Chokidar detects → Update graph → Broadcast to renderer
3. Renderer receives updated graph

## Success Criteria

- ✓ IPC handlers registered and responding
- ✓ User actions update graph and write to filesystem
- ✓ Filesystem changes update graph and broadcast to renderer
- ✓ `currentGraph` is only place with mutation
- ✓ All pure functions compose cleanly
- ✓ Unit tests pass for all handlers
- ✓ Integration test demonstrates full cycle

## Migration Strategy

**Run in parallel with existing system:**
1. Keep existing FileEventManager and GraphMutator running
2. Add new functional handlers alongside
3. Add feature flag to switch between systems
4. Gradually migrate features to functional architecture
5. Remove old system once fully migrated

**Feature flag example:**
```typescript
const USE_FUNCTIONAL_ARCHITECTURE = process.env.FUNCTIONAL_GRAPH === 'true'

if (USE_FUNCTIONAL_ARCHITECTURE) {
  setupGraphIpcHandlers(getGraph, setGraph)
} else {
  // Old system
  setupLegacyHandlers()
}
```

## Next Steps

After Phase 2:
- Phase 3: Refactor renderer to send actions instead of direct mutations
