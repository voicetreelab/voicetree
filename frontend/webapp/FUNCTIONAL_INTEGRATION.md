# Functional Graph Integration Plan - Handover Document

## 📋 Executive Summary

**Status:** Pure functional core is complete and tested (55/55 tests passing). Ready for integration with the main Electron application.

**Goal:** Wire up the functional graph system to the running application so that:
- User actions (create/update/delete nodes) work end-to-end
- File system changes automatically update the UI
- Graph state stays synchronized between filesystem, memory, and UI

**Timeline:** ~2-3 hours of focused work

---

## 🎯 Integration Architecture (Boxes & Arrows)

```
┌─────────────────────────────────────────────────────────────────────┐
│                    ELECTRON MAIN PROCESS                            │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ electron/main.ts (INTEGRATION POINT #1)                      │  │
│  │                                                               │  │
│  │  ❶ Initialize Graph Runtime                                  │  │
│  │     ┌─────────────────────────────────────┐                  │  │
│  │     │ initializeGraphRuntime(vaultPath)   │                  │  │
│  │     │  - Load initial graph from disk     │                  │  │
│  │     │  - Setup global state               │                  │  │
│  │     │  - Create environment object        │                  │  │
│  │     └─────────────────────────────────────┘                  │  │
│  │                      │                                        │  │
│  │                      ▼                                        │  │
│  │  ❷ Setup IPC Handlers                                        │  │
│  │     ┌─────────────────────────────────────┐                  │  │
│  │     │ setupGraphIpcHandlers(              │                  │  │
│  │     │   getGraph,                         │                  │  │
│  │     │   setGraph,                         │                  │  │
│  │     │   vaultPath,                        │                  │  │
│  │     │   broadcast                         │                  │  │
│  │     │ )                                   │                  │  │
│  │     └─────────────────────────────────────┘                  │  │
│  │                      │                                        │  │
│  │                      ▼                                        │  │
│  │  ❸ Setup File Watch Handlers                                 │  │
│  │     ┌─────────────────────────────────────┐                  │  │
│  │     │ setupFileWatchHandlers(             │                  │  │
│  │     │   fileWatchManager,                 │                  │  │
│  │     │   getGraph,                         │                  │  │
│  │     │   setGraph,                         │                  │  │
│  │     │   mainWindow,                       │                  │  │
│  │     │   vaultPath                         │                  │  │
│  │     │ )                                   │                  │  │
│  │     └─────────────────────────────────────┘                  │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
          │                                            │
          │ IPC Events                                 │ IPC Events
          │ (user actions)                             │ (broadcasts)
          ▼                                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    ELECTRON RENDERER PROCESS                        │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ src/views/VoiceTreeGraphView.ts (INTEGRATION POINT #2)      │  │
│  │                                                               │  │
│  │  ❹ Subscribe to Graph Updates                                │  │
│  │     ┌─────────────────────────────────────┐                  │  │
│  │     │ window.electronAPI.graph            │                  │  │
│  │     │   .onStateChanged((graph) => {      │                  │  │
│  │     │     this.updateCytoscape(graph)     │                  │  │
│  │     │   })                                │                  │  │
│  │     └─────────────────────────────────────┘                  │  │
│  │                      │                                        │  │
│  │                      ▼                                        │  │
│  │  ❺ Wire User Actions to IPC                                  │  │
│  │     ┌─────────────────────────────────────┐                  │  │
│  │     │ onAddNodeClick() {                  │                  │  │
│  │     │   const action = createCreateNode   │                  │  │
│  │     │     Action(nodeId, content)         │                  │  │
│  │     │   electronAPI.graph.createNode(     │                  │  │
│  │     │     action                          │                  │  │
│  │     │   )                                 │                  │  │
│  │     │ }                                   │                  │  │
│  │     └─────────────────────────────────────┘                  │  │
│  │                      │                                        │  │
│  │                      ▼                                        │  │
│  │  ❻ Update Cytoscape                                          │  │
│  │     ┌─────────────────────────────────────┐                  │  │
│  │     │ updateCytoscape(graph: Graph) {     │                  │  │
│  │     │   const elements =                  │                  │  │
│  │     │     projectToCytoscape(graph)       │                  │  │
│  │     │   reconcileCytoscape(elements)      │                  │  │
│  │     │ }                                   │                  │  │
│  │     └─────────────────────────────────────┘                  │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 📝 Integration Steps (Function-Level Plan)

### Step 1: Create Graph Runtime Module (NEW FILE)

**File:** `src/functional_graph/shell/main/graph-runtime.ts`

**Purpose:** Centralize graph state management and environment setup

**Functions to implement:**

```typescript
/**
 * Global state - single source of truth
 */
let currentGraph: Graph = { nodes: {}, edges: {} }

/**
 * Initialize the graph runtime system
 *
 * @param vaultPath - Path to the markdown vault
 * @returns Promise that resolves when initialization is complete
 */
export async function initializeGraphRuntime(
  vaultPath: string
): Promise<void> {
  // Load initial graph from disk
  const loadGraph = loadGraphFromDisk(vaultPath)
  currentGraph = await loadGraph()

  console.log('[GraphRuntime] Initialized with',
    Object.keys(currentGraph.nodes).length, 'nodes')
}

/**
 * Get current graph state (pure function)
 */
export function getGraph(): Graph {
  return currentGraph
}

/**
 * Set graph state (impure - mutation)
 */
export function setGraph(graph: Graph): void {
  currentGraph = graph
}

/**
 * Create environment object for effect execution
 *
 * @param vaultPath - Path to vault
 * @param mainWindow - BrowserWindow for broadcasting
 * @returns Environment object
 */
export function createEnv(
  vaultPath: string,
  mainWindow: BrowserWindow
): Env {
  return {
    vaultPath,
    broadcast: (graph: Graph) => {
      mainWindow.webContents.send('graph:stateChanged', graph)
    }
  }
}
```

**Imports needed:**
```typescript
import { loadGraphFromDisk } from './load-graph-from-disk'
import type { Graph, Env } from '@/functional_graph/pure/types'
import type { BrowserWindow } from 'electron'
```

---

### Step 2: Wire Up in `electron/main.ts`

**File:** `electron/main.ts`

**Location:** After `mainWindow` is created, before `app.on('ready')`

**Code to add:**

```typescript
import { initializeGraphRuntime, getGraph, setGraph, createEnv } from '@/functional_graph/shell/main/graph-runtime'
import { setupGraphIpcHandlers } from './handlers/ipc-graph-handlers'
import { setupFileWatchHandlers } from './handlers/file-watch-handlers'

// After mainWindow is created:
async function initializeFunctionalGraph() {
  const vaultPath = '/path/to/vault' // TODO: Get from settings

  console.log('[Main] Initializing functional graph system...')

  // Step 1: Initialize graph runtime
  await initializeGraphRuntime(vaultPath)

  // Step 2: Create environment
  const env = createEnv(vaultPath, mainWindow)

  // Step 3: Setup IPC handlers
  setupGraphIpcHandlers(
    getGraph,
    setGraph,
    vaultPath,
    env.broadcast
  )

  // Step 4: Setup file watch handlers
  // (Assuming you have fileWatchManager already initialized)
  setupFileWatchHandlers(
    fileWatchManager,
    getGraph,
    setGraph,
    mainWindow,
    vaultPath
  )

  console.log('[Main] Functional graph system ready!')
}

// Call after mainWindow is created
app.whenReady().then(async () => {
  createWindow()
  await initializeFunctionalGraph()
})
```

**Integration points to find:**
- ✅ `mainWindow` - Should already exist
- ✅ `fileWatchManager` - Should already exist
- ⚠️ `vaultPath` - Need to get from settings/config

**Search commands:**
```bash
# Find where mainWindow is created
rg "mainWindow = new BrowserWindow" electron/

# Find where fileWatchManager is initialized
rg "fileWatchManager = new" electron/

# Find where vaultPath is configured
rg "vaultPath" electron/
```

---

### Step 3: Setup Preload API (electron/preload.ts)

**File:** `electron/preload.ts`

**Code to add/verify:**

```typescript
import { ipcRenderer, contextBridge } from 'electron'
import type { Graph, NodeAction } from '@/functional_graph/pure/types'

// Expose IPC API to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  graph: {
    // Send user actions to main process
    createNode: (action: Extract<NodeAction, { type: 'CreateNode' }>) =>
      ipcRenderer.invoke('graph:createNode', action),

    updateNode: (action: Extract<NodeAction, { type: 'UpdateNode' }>) =>
      ipcRenderer.invoke('graph:updateNode', action),

    deleteNode: (action: Extract<NodeAction, { type: 'DeleteNode' }>) =>
      ipcRenderer.invoke('graph:deleteNode', action),

    // Get current graph state
    getState: () =>
      ipcRenderer.invoke('graph:getState'),

    // Subscribe to graph updates from main process
    onStateChanged: (callback: (graph: Graph) => void) => {
      const subscription = (_event: any, graph: Graph) => callback(graph)
      ipcRenderer.on('graph:stateChanged', subscription)

      // Return unsubscribe function
      return () => {
        ipcRenderer.removeListener('graph:stateChanged', subscription)
      }
    }
  }
})
```

**Type declarations (for TypeScript):**

Create/update `src/types/electron.d.ts`:

```typescript
import type { Graph, NodeAction } from '@/functional_graph/pure/types'

interface ElectronAPI {
  graph: {
    createNode: (action: Extract<NodeAction, { type: 'CreateNode' }>) => Promise<{ success: boolean; error?: string }>
    updateNode: (action: Extract<NodeAction, { type: 'UpdateNode' }>) => Promise<{ success: boolean; error?: string }>
    deleteNode: (action: Extract<NodeAction, { type: 'DeleteNode' }>) => Promise<{ success: boolean; error?: string }>
    getState: () => Promise<{ success: boolean; graph?: Graph; error?: string }>
    onStateChanged: (callback: (graph: Graph) => void) => () => void
  }
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
```

---

### Step 4: Update VoiceTreeGraphView (Renderer)

**File:** `src/views/VoiceTreeGraphView.ts`

**Functions to add/modify:**

#### 4.1: Subscribe to Graph Updates

```typescript
import { projectToCytoscape } from '@/functional_graph/pure/cytoscape/project-to-cytoscape'
import type { Graph } from '@/functional_graph/pure/types'

export class VoiceTreeGraphView {
  private unsubscribeGraphUpdates: (() => void) | null = null

  async onload() {
    // ... existing code ...

    // Subscribe to graph state changes from main process
    this.subscribeToGraphUpdates()
  }

  onunload() {
    // Unsubscribe when view is closed
    if (this.unsubscribeGraphUpdates) {
      this.unsubscribeGraphUpdates()
    }
  }

  private subscribeToGraphUpdates(): void {
    if (typeof window !== 'undefined' && window.electronAPI?.graph) {
      this.unsubscribeGraphUpdates = window.electronAPI.graph.onStateChanged(
        (graph: Graph) => {
          console.log('[VoiceTreeGraphView] Graph state updated:',
            Object.keys(graph.nodes).length, 'nodes')
          this.updateCytoscapeFromGraph(graph)
        }
      )
    }
  }

  private updateCytoscapeFromGraph(graph: Graph): void {
    // Convert graph to Cytoscape elements
    const elements = projectToCytoscape(graph)

    // Reconcile with current Cytoscape state
    this.reconcileCytoscape(elements)
  }

  private reconcileCytoscape(elements: CytoscapeElements): void {
    // This is the reconciliation logic from GraphStateManager
    this.cy.batch(() => {
      const desiredNodeIds = new Set(elements.nodes.map(n => n.data.id))
      const desiredEdgeIds = new Set(elements.edges.map(e => e.data.id))

      // Add/update nodes
      elements.nodes.forEach(nodeElem => {
        const existing = this.cy.getElementById(nodeElem.data.id)
        if (existing.length > 0) {
          // Update if data changed
          existing.data(nodeElem.data)
        } else {
          // Add new node
          this.cy.add({ group: 'nodes' as const, data: nodeElem.data })
        }
      })

      // Add/update edges
      elements.edges.forEach(edgeElem => {
        const existing = this.cy.getElementById(edgeElem.data.id)
        if (existing.length === 0) {
          this.cy.add({ group: 'edges' as const, data: edgeElem.data })
        }
      })

      // Remove nodes not in desired set
      this.cy.nodes().forEach(node => {
        if (node.data('isGhostRoot') || node.data('isFloatingWindow')) {
          return
        }
        if (!desiredNodeIds.has(node.id())) {
          node.remove()
        }
      })

      // Remove edges not in desired set
      this.cy.edges().forEach(edge => {
        if (!desiredEdgeIds.has(edge.id())) {
          edge.remove()
        }
      })
    })
  }
}
```

#### 4.2: Wire User Actions to IPC

Find existing user action handlers and update them:

```typescript
import {
  createCreateNodeAction,
  createUpdateNodeAction,
  createDeleteNodeAction
} from '@/functional_graph/pure/action-creators'

export class VoiceTreeGraphView {
  // When user clicks "Add Node" button
  private async handleAddNode(nodeId: string, content: string, position?: { x: number, y: number }) {
    const action = createCreateNodeAction(nodeId, content, position)

    const result = await window.electronAPI.graph.createNode(action)

    if (!result.success) {
      console.error('Failed to create node:', result.error)
      // TODO: Show error to user
    }
  }

  // When user edits node content
  private async handleUpdateNode(nodeId: string, newContent: string) {
    const action = createUpdateNodeAction(nodeId, newContent)

    const result = await window.electronAPI.graph.updateNode(action)

    if (!result.success) {
      console.error('Failed to update node:', result.error)
      // TODO: Show error to user
    }
  }

  // When user deletes node
  private async handleDeleteNode(nodeId: string) {
    const action = createDeleteNodeAction(nodeId)

    const result = await window.electronAPI.graph.deleteNode(action)

    if (!result.success) {
      console.error('Failed to delete node:', result.error)
      // TODO: Show error to user
    }
  }
}
```

**Search for existing handlers:**
```bash
# Find where nodes are currently created
rg "add.*node" src/views/VoiceTreeGraphView.ts -i

# Find where nodes are updated
rg "update.*node" src/views/VoiceTreeGraphView.ts -i

# Find where nodes are deleted
rg "delete.*node" src/views/VoiceTreeGraphView.ts -i
```

---

### Step 5: Remove Old Legacy Code (CLEANUP)

After integration is working, remove deprecated code:

**Files to remove/update:**

1. **GraphStateManager** (if it exists and is unused)
   - `src/functional_graph/shell/renderer/GraphStateManager.ts` (already commented out)
   - Remove the file entirely

2. **Old FileEventManager integration** (if any)
   - Search for direct file parsing in renderer
   - Replace with graph state subscriptions

3. **Old apply-graph-updates/apply-db-updates** (if old versions exist)
   - The files should now be:
     - `src/functional_graph/pure/applyGraphActionsToDB.ts`
     - `src/functional_graph/pure/applyFSEventToGraph.ts`
   - Remove any old versions in `src/graph-core/functional/`

**Search commands:**
```bash
# Find old functional code locations
find src/graph-core/functional -name "*.ts" 2>/dev/null

# Check for GraphStateManager usage
rg "GraphStateManager" src/
```

---

## 🧪 Testing Plan

### Manual Testing Checklist

**Setup:**
1. ✅ Build the app: `npm run build`
2. ✅ Run the app: `npm run electron`
3. ✅ Open DevTools console in both main and renderer

**Test 1: Initial Load**
- [ ] App opens without errors
- [ ] Console shows: "[GraphRuntime] Initialized with N nodes"
- [ ] Console shows: "[IPC] Graph handlers registered"
- [ ] Console shows: "[FileWatch] Graph handlers registered"
- [ ] Cytoscape displays all nodes from vault

**Test 2: Create Node (User Action)**
- [ ] Click "Add Node" button
- [ ] New file created in vault: `vault/{nodeId}.md`
- [ ] Node appears in Cytoscape graph
- [ ] Console shows successful IPC call
- [ ] File watcher detects new file and updates state

**Test 3: Update Node (User Action)**
- [ ] Edit node content in UI
- [ ] File updated in vault
- [ ] Node label/content updates in Cytoscape
- [ ] Console shows successful IPC call

**Test 4: Delete Node (User Action)**
- [ ] Delete node from UI
- [ ] File removed from vault
- [ ] Node removed from Cytoscape
- [ ] Connected edges removed

**Test 5: External File Create**
- [ ] Create new .md file in vault using VS Code
- [ ] Node automatically appears in Cytoscape
- [ ] Console shows file-added event

**Test 6: External File Update**
- [ ] Edit .md file in VS Code
- [ ] Node updates in Cytoscape (label, edges)
- [ ] Console shows file-changed event

**Test 7: External File Delete**
- [ ] Delete .md file using file explorer
- [ ] Node removed from Cytoscape
- [ ] Console shows file-deleted event

### Automated Testing

**Integration test to add:**

**File:** `tests/integration/functional-graph-e2e.test.ts`

```typescript
import { test, expect } from '@playwright/test'
import { _electron as electron } from 'playwright'

test.describe('Functional Graph E2E', () => {
  test('should handle user create node action', async () => {
    const app = await electron.launch({ args: ['.'] })
    const window = await app.firstWindow()

    // Click add node button
    await window.click('[data-testid="add-node-button"]')

    // Verify node appears in graph
    const nodeCount = await window.locator('.cy-node').count()
    expect(nodeCount).toBeGreaterThan(0)

    await app.close()
  })

  test('should handle external file changes', async () => {
    const app = await electron.launch({ args: ['.'] })
    const window = await app.firstWindow()

    // Create file externally
    const fs = require('fs')
    fs.writeFileSync('vault/test-node.md', '# Test Node')

    // Wait for update
    await window.waitForTimeout(1000)

    // Verify node appears
    const node = window.locator('[data-id="test-node"]')
    await expect(node).toBeVisible()

    await app.close()
  })
})
```

---

## 🚨 Potential Issues & Solutions

### Issue 1: vaultPath Not Found

**Symptom:** `initializeGraphRuntime` fails with "vault not found"

**Solution:**
```typescript
// In electron/main.ts
import path from 'path'

const vaultPath = process.env.VAULT_PATH ||
  path.join(app.getPath('userData'), 'vault')

// Ensure vault exists
const fs = require('fs')
if (!fs.existsSync(vaultPath)) {
  fs.mkdirSync(vaultPath, { recursive: true })
}
```

### Issue 2: fileWatchManager Not Initialized

**Symptom:** `setupFileWatchHandlers` receives undefined

**Solution:**
```typescript
// In electron/main.ts
// Ensure fileWatchManager is initialized BEFORE calling setup
if (!fileWatchManager) {
  console.error('[Main] fileWatchManager not initialized!')
  return
}

setupFileWatchHandlers(fileWatchManager, ...)
```

### Issue 3: Graph State Not Broadcasting

**Symptom:** UI doesn't update when files change

**Debug:**
```typescript
// Add logging to broadcast function
broadcast: (graph: Graph) => {
  console.log('[Broadcast] Sending graph update:',
    Object.keys(graph.nodes).length, 'nodes')
  mainWindow.webContents.send('graph:stateChanged', graph)
}

// In renderer, verify subscription
window.electronAPI.graph.onStateChanged((graph) => {
  console.log('[Renderer] Received graph update:',
    Object.keys(graph.nodes).length, 'nodes')
})
```

### Issue 4: Type Errors in Renderer

**Symptom:** `window.electronAPI` is undefined in TypeScript

**Solution:**
Ensure `src/types/electron.d.ts` is included in `tsconfig.json`:

```json
{
  "include": [
    "src/**/*",
    "electron/**/*",
    "src/types/**/*"
  ]
}
```

---

## 📚 Reference: Key Function Signatures

### Pure Layer Functions

```typescript
// Load graph from disk
loadGraphFromDisk(vaultPath: string): IO<Graph>

// User actions → DB effects
apply_graph_updates(
  graph: Graph,
  action: NodeAction
): AppEffect<Graph>

// FS events → Graph updates
apply_db_updates_to_graph(
  graph: Graph,
  update: FSUpdate
): EnvReader<Graph>

// Graph → Cytoscape
projectToCytoscape(graph: Graph): CytoscapeElements

// Action creators
createCreateNodeAction(nodeId: string, content: string, position?: Position): CreateNode
createUpdateNodeAction(nodeId: string, content: string): UpdateNode
createDeleteNodeAction(nodeId: string): DeleteNode
```

### Runtime Functions (To Implement)

```typescript
// Initialize system
initializeGraphRuntime(vaultPath: string): Promise<void>

// State accessors
getGraph(): Graph
setGraph(graph: Graph): void

// Environment factory
createEnv(vaultPath: string, mainWindow: BrowserWindow): Env
```

### Handler Functions (Already Implemented)

```typescript
// Setup IPC handlers
setupGraphIpcHandlers(
  getGraph: () => Graph,
  setGraph: (graph: Graph) => void,
  vaultPath: string,
  broadcast: (graph: Graph) => void
): void

// Setup file watch handlers
setupFileWatchHandlers(
  fileWatchManager: FileWatchManager,
  getGraph: () => Graph,
  setGraph: (graph: Graph) => void,
  mainWindow: BrowserWindow,
  vaultPath: string
): void
```

---

## ✅ Definition of Done

Integration is complete when:

- [ ] `npm run electron` starts without errors
- [ ] Console shows all handlers registered
- [ ] Initial graph loads from vault
- [ ] User can create/update/delete nodes via UI
- [ ] Files appear/update/disappear in vault
- [ ] External file changes update UI automatically
- [ ] No TypeScript errors (`npx tsc --noEmit`)
- [ ] No ESLint errors (warnings OK)
- [ ] All existing tests still pass
- [ ] At least 1 E2E test passes

---

## 🎯 Success Metrics

| Metric | Target | How to Verify |
|--------|--------|---------------|
| Initial load time | < 2 seconds | Console timestamp |
| User action latency | < 100ms | UI responsiveness |
| File change detection | < 500ms | External edit → UI update |
| Memory leaks | 0 | Run for 10 min, check memory |
| Type safety | 100% | `npx tsc --noEmit` |
| Test coverage | > 80% | Functional core tests |

---

## 📞 Help & Resources

**Documentation:**
- `FUNCTIONAL_ARCHITECTURE.md` - System overview
- `FP_LEARNINGS.md` - Common FP mistakes to avoid
- `CLAUDE.md` - Project-wide conventions

**Key Files:**
- Pure layer: `src/functional_graph/pure/`
- Handlers: `electron/handlers/`
- Types: `src/functional_graph/pure/types.ts`

**Debug Commands:**
```bash
# Run functional tests
npm run test -- tests/unit/graph-core/functional/ --run

# Type check
npx tsc --noEmit

# Build and run
npm run build && npm run electron

# Check for old code
rg "GraphStateManager" src/
rg "apply_graph_updates.*vaultPath" electron/
```

**Common Gotchas:**
1. Don't call `env.broadcast()` in pure functions - only in handlers!
2. Remember `effect(env)()` - two function calls for Reader + TaskEither
3. Check `window.electronAPI` exists before using in renderer
4. FileWatchManager must be initialized before handlers setup
5. Vault path must exist before `loadGraphFromDisk`

---

## 🚀 Quick Start (TL;DR)

```bash
# 1. Create runtime module
touch src/functional_graph/shell/main/graph-runtime.ts
# (Copy code from Step 1 above)

# 2. Wire up in main.ts
# (Add initialization code from Step 2)

# 3. Update preload.ts
# (Add IPC API from Step 3)

# 4. Update VoiceTreeGraphView
# (Add subscription code from Step 4)

# 5. Test
npm run build
npm run electron
# Click around, edit files, verify it works!

# 6. Celebrate 🎉
```

---

**Estimated Time:** 2-3 hours for complete integration + testing

**Next Session Goal:** Wire up main.ts and test basic create/update/delete flow

**Handover Status:** ✅ Ready for integration. Pure core is solid, handlers are tested, just need to connect the wires!
