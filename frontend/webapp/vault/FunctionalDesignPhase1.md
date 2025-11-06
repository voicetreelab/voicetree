# Migration Plan: Functional Graph Architecture

## Core Types

```haskell
-- Domain Model
type Graph = Graph
  { nodes :: Record NodeId Node
  , outgoingEdges :: Record NodeId [NodeId]  -- Adjacency list
  }

data Node = Node
  { relativeFilePathIsID :: NodeId
  , title :: String
  , content :: String
  , summary :: String
  , color :: Maybe String
  }

-- Actions
data GraphDelta
  = AddNode NodeId String (Maybe Position)
  | UpdateNode NodeId String
  | DeleteNode NodeId

-- External events
data FSUpdate = FSUpdate
  { absolutePath :: FilePath
  , content :: String
  , eventType :: FSEventType  -- Added | Changed | Deleted
  }
```

## The Two Core Functions

```haskell
-- 1. User actions → update graph + persist
apply_graph_deltas :: Graph -> GraphDelta -> (Graph, DBIO ())
apply_graph_deltas graph action =
  let newGraph = applyActionToGraph graph action
      dbEffect = persistAction action  -- writes to FS, async
  in (newGraph, dbEffect)

where
  applyActionToGraph :: Graph -> GraphDelta -> Graph
  applyActionToGraph g (AddNode nodeId content pos) =
    let node = Node
          { relativeFilePathIsID = nodeId
          , content = content
          , title = extractTitle content
          , linkedNodeIds = extractLinks content
          , summary = ""
          }
    in g { nodes = Map.insert nodeId node (nodes g) }

  persistAction :: GraphDelta -> DBIO ()
  persistAction (AddNode nodeId content _) =
    writeFile (nodeId <> ".md") content


-- 2. FS changes → update graph + broadcast
apply_db_updates_to_graph :: Graph -> FSUpdate -> (Graph, UIIO ())
apply_db_updates_to_graph graph fsUpdate =
  let newGraph = applyFSUpdateToGraph graph fsUpdate
      uiEffect = broadcast newGraph  -- sends to renderer
  in (newGraph, uiEffect)

where
  applyFSUpdateToGraph :: Graph -> FSUpdate -> Graph
  applyFSUpdateToGraph g (FSUpdate absolutePath content Added) =
    let node = parseMarkdownToGraphNode content absolutePath
    in g { nodes = Map.insert (node.relativeFilePathIsID) node (nodes g) }

  applyFSUpdateToGraph g (FSUpdate absolutePath content Changed) =
    let node = parseMarkdownToGraphNode content absolutePath
    in g { nodes = Map.insert (node.relativeFilePathIsID) node (nodes g) }

  applyFSUpdateToGraph g (FSUpdate absolutePath _ Deleted) =
    let nodeId = pathToNodeId absolutePath
    in g { nodes = Map.delete nodeId (nodes g) }
```

## Projection (Idempotent)

```haskell
-- Pure projection to UI representation
projectToCytoscape :: Graph -> CytoscapeElements
projectToCytoscape graph =
  CytoscapeElements
    { nodes = map nodeToElement (Map.elems (nodes graph))
    , outgoingEdges = map edgeToElement (Map.elems (outgoingEdges graph))
    }

-- Renderer applies projection (reconciles automatically)
updateCytoscape :: CytoscapeCore -> CytoscapeElements -> UIIO ()
updateCytoscape cy elements =
  forM_ (elements.nodes) $ \elem ->
    case getElementById cy elem.relativeFilePathIsID of
      Just existing -> updateIfChanged existing elem  -- no-op if same
      Nothing -> addElement cy elem                   -- new node
```

## Migration Steps

### Phase 1: Create Graph in Main Process
```haskell
-- electron/graph-manager.ts
data GraphManager = GraphManager
  { graph :: IORef Graph
  , fileWatcher :: FileWatcher
  }

initGraphManager :: FilePath -> IO GraphManager
initGraphManager vaultPath = do
  files <- loadAllMarkdownFiles vaultPath
  let initialGraph = loadGraphFromFiles files
  graphRef <- newIORef initialGraph
  watcher <- watchDirectory vaultPath
  return $ GraphManager graphRef watcher
```

### Phase 2: Wire Up Event Handlers
```haskell
-- Main process event loop
main :: IO ()
main = do
  manager <- initGraphManager vaultPath

  -- Handle user actions from renderer
  ipcHandle "graph:applyUpdate" $ \action -> do
    graph <- readIORef (graph manager)
    let (newGraph, dbEffect) = apply_graph_deltas graph action
    writeIORef (graph manager) newGraph
    runDBIO dbEffect

  -- Handle filesystem changes
  onFileChange (fileWatcher manager) $ \fsUpdate -> do
    graph <- readIORef (graph manager)
    let (newGraph, uiEffect) = apply_db_updates_to_graph graph fsUpdate
    writeIORef (graph manager) newGraph
    runUIIO uiEffect
```

### Phase 3: Refactor Renderer to Send Actions
```haskell
-- Renderer (at the edge)
handleAddNode :: Position -> IO ()
handleAddNode pos = do
  let action = AddNode (generateId ()) "# New Node" (Just pos)

  -- Optimistic UI update
  cy.add { relativeFilePathIsID = action.nodeId, label = "New Node", position = pos }

  -- Send to main for persistence
  electronAPI.graph.applyUpdate action

-- Receive broadcasts for external changes
onGraphStateChanged :: (Graph -> IO ()) -> IO ()
onGraphStateChanged callback =
  electronAPI.on "graph-state-changed" $ \graph ->
    callback graph >> projectToCytoscape graph cy
```

## Rollout Strategy

1. **Add types** (GraphState, GraphDelta) - no behavior change
2. **Implement apply_graph_deltas** in main - parallel to existing code
3. **Implement apply_db_updates_to_graph** - runs alongside FileEventManager
4. **Add projection layer** in renderer - coexists with direct mutations
5. **Gradually migrate** user actions to send NodeActions
6. **Remove** FileEventManager mutation logic once all actions migrated
7. **Remove** IMarkdownVaultProvider events (replaced by graph broadcasts)

## Success Criteria

- ✓ All graph mutations go through `apply_graph_deltas` or `apply_db_updates_to_graph`
- ✓ Renderer never directly mutates Cytoscape for graph data (only UI state)
- ✓ Filesystem is source of truth, Graph is cached projection
- ✓ All tests pass with new architecture
