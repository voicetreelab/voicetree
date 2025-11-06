# Functional Graph Architecture - Updated Diagram

## 📊 High-Level Architecture (Boxes & Arrows)

```
┌─────────────────────────────────────────────────────────────────────┐
│                        RENDERER PROCESS                             │
│                                                                     │
│  ┌──────────────┐                                                  │
│  │ User Actions │  (onClick, addNode, updateNode, deleteNode)      │
│  └──────┬───────┘                                                  │
│         │         side effect: optimistic UI updates               │
│         │ IPC                                                      │
│         ▼                                                           │
└─────────────────────────────────────────────────────────────────────┘
          │
          │ 'graph:update' (SINGLE CONSOLIDATED HANDLER)
          │
┌─────────▼───────────────────────────────────────────────────────────┐
│                         MAIN PROCESS                                │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │         IMPURE SHELL (electron/handlers/)                  │   │
│  │                                                             │   │
│  │  ┌──────────────────────────────────────┐                 │   │
│  │  │  ipc-graph-handlers.ts               │                 │   │
│  │  │  (AUTO-REGISTERED AT MODULE LOAD)    │                 │   │
│  │  │                                       │                 │   │
│  │  │  ipcMain.handle('graph:update')      │                 │   │
│  │  │    1. getGraph() → Graph             │ ◄───────────┐   │   │
│  │  │    2. getVaultPath() → vaultPath     │ ◄─────────┐ │   │   │
│  │  │    3. getMainWindow() → window       │ ◄───────┐ │ │   │   │
│  │  │    4. Build Env from global state    │         │ │ │   │   │
│  │  │    5. Build effect:                  │         │ │ │   │   │
│  │  │       effect = apply_graph_deltas   │         │ │ │   │   │
│  │  │                (graph, action)       │         │ │ │   │   │
│  │  │    6. Execute: result = effect(env)()│────┐    │ │ │   │   │
│  │  │    7. setGraph(result.right)         │    │    │ │ │   │   │
│  │  │    8. env.broadcast(result.right)    │────┼─┐  │ │ │   │   │
│  │  └──────────────────────────────────────┘    │ │  │ │ │   │   │
│  │                                               │ │  │ │ │   │   │
│  │  ┌──────────────────────────────────────┐    │ │  │ │ │   │   │
│  │  │  file-watch-handlers.ts              │    │ │  │ │ │   │   │
│  │  │  (INITIALIZED ONCE, NOT SETUP)       │    │ │  │ │ │   │   │
│  │  │                                       │    │ │  │ │ │   │   │
│  │  │  onFileChange(absolutePath, content)         │    │ │  │ │ │   │   │
│  │  │    1. getGraph() → Graph             │ ◄──┼─┼──┼─┼─┤   │   │
│  │  │    2. getVaultPath() → vaultPath     │ ◄──┼─┼──┼─┘ │   │   │
│  │  │    3. getMainWindow() → window       │ ◄──┼─┼──┘   │   │   │
│  │  │    4. Build Env from global state    │    │ │      │   │   │
│  │  │    5. Build effect:                  │    │ │      │   │   │
│  │  │       effect = apply_db_updates      │    │ │      │   │   │
│  │  │                (graph, fsUpdate)     │    │ │      │   │   │
│  │  │    6. Execute: newGraph = effect(env)│────┼─┼───┐  │   │   │
│  │  │    7. setGraph(newGraph)             │    │ │   │  │   │   │
│  │  │    8. env.broadcast(newGraph)        │────┼─┼───┼─┐│   │   │
│  │  └──────────────────────────────────────┘    │ │   │ ││   │   │
│  │                                               │ │   │ ││   │   │
│  │  Global State (PUSHED TO EDGES)              │ │   │ ││   │   │
│  │  let currentGraph: Graph ◄────────────────────┘ │   │ ││   │   │
│  │  let currentVaultPath: string ◄─────────────────┘   │ ││   │   │
│  │  let currentMainWindow: BrowserWindow ◄──────────────┘ ││   │   │
│  │                                                        ││   │   │
│  │  Getters/Setters for controlled access:               ││   │   │
│  │  • getGraph() / setGraph()                            ││   │   │
│  │  • getVaultPath() / setVaultPath()                    ││   │   │
│  │  • getMainWindow() / setMainWindow()                  ││   │   │
│  │                                                        ││   │   │
│  │  Environment (Env) - CONSTRUCTED FRESH EACH TIME:     ││   │   │
│  │  • vaultPath: getVaultPath()                          ││   │   │
│  │  • broadcast: (graph) => getMainWindow().send(...)    ││   │   │
│  └────────────────────────────────────────────────────────┼┼───┼───┤
│                                                            ││   │   │
│  ┌────────────────────────────────────────────────────────▼▼───┼───┤
│  │         PURE LAYER (src/functional_graph/pure/)           │   │
│  │                                                            │   │
│  │  ┌───────────────────────────────────────┐                │   │
│  │  │  applyGraphActionsToDB.ts             │                │   │
│  │  │                                        │                │   │
│  │  │  apply_graph_deltas(                 │                │   │
│  │  │    graph: Graph,                      │                │   │
│  │  │    action: GraphDelta                 │                │   │
│  │  │  ): AppEffect<Graph>                  │                │   │
│  │  │                                        │                │   │
│  │  │  Returns: (env: Env) =>               │                │   │
│  │  │    TaskEither<Error, Graph>           │                │   │
│  │  │                                        │                │   │
│  │  │  Effect Description:                  │                │   │
│  │  │  • Update graph (pure)                │                │   │
│  │  │  • Wrap fs.writeFile in TaskEither   │                │   │
│  │  │  • Return new Graph                   │                │   │
│  │  └───────────────────────────────────────┘                │   │
│  │                                                            │   │
│  │  ┌───────────────────────────────────────┐                │   │
│  │  │  applyFSEventToGraph.ts               │                │   │
│  │  │                                        │                │   │
│  │  │  apply_db_updates_to_graph(           │                │   │
│  │  │    graph: Graph,                      │                │   │
│  │  │    update: FSUpdate                   │                │   │
│  │  │  ): EnvReader<Graph>                  │                │   │
│  │  │                                        │                │   │
│  │  │  Returns: (env: Env) => Graph         │                │   │
│  │  │                                        │                │   │
│  │  │  Pure Computation:                    │                │   │
│  │  │  • Parse markdown                     │                │   │
│  │  │  • Update graph structure             │                │   │
│  │  │  • Extract outgoingEdges from [[links]]       │                │   │
│  │  │  • Return new Graph (NO broadcast!)   │                │   │
│  │  │  • vaultPath passed as parameter      │                │   │
│  │  └───────────────────────────────────────┘                │   │
│  │                                                            │   │
│  │  Other Pure Functions:                                    │   │
│  │  • uiInteractionsToGraphDeltas.ts       (Build GraphDelta objects)    │   │
│  │  • project-to-cytoscape.ts  (Graph → CytoscapeElements)   │   │
│  │  • markdown_parsing/        (Parse markdown, extract data)│   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌─────────────────────────────────────────┐                     │
│  │  FILE SYSTEM (Vault)                    │                     │
│  │                                          │                     │
│  │  vault/                                  │                     │
│  │  ├── node1.md  ◄──── fs.writeFile ───────┼─────────────────────┘
│  │  ├── node2.md                            │
│  │  └── node3.md  ───── fs watch ──────────┐│
│  └─────────────────────────────────────────┘│
│                                              │
│                                              └─── FileWatchHandler
└──────────────────────────────────────────────────────────────────┘
          │
          │ IPC: 'graph:stateChanged'
          │
┌─────────▼───────────────────────────────────────────────────────────┐
│                     RENDERER PROCESS                                │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────┐     │
│  │  VoiceTreeGraphView / Cytoscape                          │     │
│  │                                                           │     │
│  │  onGraphStateChanged(graph: Graph)                       │     │
│  │    1. Project: elements = projectToCytoscape(graph)      │     │
│  │    2. Reconcile: cy.batch(() => update DOM)              │     │
│  └──────────────────────────────────────────────────────────┘     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Key Architecture Changes

### 1. Consolidated IPC Handler
**Before:**
- 3 separate handlers: `graph:createNode`, `graph:updateNode`, `graph:deleteNode`
- ~150 lines of duplicated code

**After:**
- 1 unified handler: `graph:update` accepting `GraphDelta`
- ~50 lines, single point of maintenance
- Type safety maintained via discriminated union

### 2. Global State at Edges
**Before:**
- `vaultPath` captured in closures during setup
- Setup functions: `setupGraphIpcHandlers()`, `setupFileWatchHandlers()`
- Multiple sources of truth

**After:**
- Global state: `currentGraph`, `currentVaultPath`, `currentMainWindow`
- Controlled access via getters/setters
- Handlers auto-register at module load
- `Env` constructed fresh from global state each time

### 3. Functional Core Preserved
**Pure functions still receive `vaultPath` as input:**
```typescript
// Env passed to pure functions
const env: Env = {
  vaultPath: getVaultPath(),  // Read from global
  broadcast: (graph) => {...}
}

// Pure function receives it as parameter
const effect = apply_graph_deltas(currentGraph, action)
const result = await effect(env)()  // Env provided here
```

## Data Flow: User Creates Node

```
1. User clicks "Add Node" (Renderer)
   │
2. electronAPI.graph.update({ type: 'CreateNode', ... })
   │
3. IPC: 'graph:update' → Main Process
   │
4. Handler (IMPURE):
   │ - getGraph() → currentGraph
   │ - getVaultPath() → vaultPath
   │ - Build Env from global state
   │ - Call: apply_graph_deltas(graph, action)
   │ - Execute: await effect(env)()
   │
5. Pure Layer:
   │ - Update graph structure (pure)
   │ - Create TaskEither for fs.writeFile
   │ - Return new Graph
   │
6. Handler Side Effects:
   │ - setGraph(newGraph)
   │ - env.broadcast(newGraph)
   │ - fs.writeFile executes
   │
7. FileWatchHandler detects new file
   │
8. File Handler (IMPURE):
   │ - Build Env from global state
   │ - Call: apply_db_updates_to_graph(graph, fsUpdate)
   │ - Execute: newGraph = effect(env)
   │ - env.broadcast(newGraph)
   │
9. Renderer receives 'graph:stateChanged'
   │
10. Cytoscape reconciles → UI updates
```

## Principles Applied

1. **Single Solution Principle**: One handler for updates, not three
2. **Push Impurity to Edges**: Global state lives in impure shell
3. **Functional Core**: Pure functions receive `vaultPath` as input
4. **No Indirection**: Direct access, no wrapper functions
