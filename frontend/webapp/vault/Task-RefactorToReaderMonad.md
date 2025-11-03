# Task: Refactor DBIO/UIIO to Reader Monad Pattern

## Problem

Currently (Phase 2 implementation), we're using **currying** to inject dependencies like `vaultPath` and `broadcast` function:

```typescript
// Current implementation - WRONG PATTERN
export function apply_graph_updates(vaultPath: string) {
  return (graph: Graph, action: NodeAction): [Graph, DBIO<void>] => {
    // vaultPath captured in closure
    const dbEffect = async () => {
      await fs.writeFile(path.join(vaultPath, ...), ...)
    }
    return [newGraph, dbEffect]
  }
}

// Usage - must curry first
const apply = apply_graph_updates('/vault/path')
const [newGraph, effect] = apply(graph, action)
```

**Problems with this approach:**
1. ❌ **Can't change vault** - Once curried, vaultPath is fixed in closure
2. ❌ **Tests broken** - Tests don't know about curried signature
3. ❌ **Not idiomatic FP** - Environment should be in the monad, not in outer closure
4. ❌ **Hidden dependency** - vaultPath is captured invisibly
5. ❌ **Violates Single Solution Principle** - We have both curried and direct versions

## Why Reader Monad?

In functional programming, the **Reader monad** (also called Environment monad) is specifically designed for:
- Passing configuration/environment through a computation
- Avoiding global state
- Making dependencies explicit
- Allowing environment to change between executions

### The Pattern in Haskell

```haskell
-- Reader monad: function from environment to value
type Reader env a = env -> a

-- Our environment
data GraphEnv = GraphEnv
  { vaultPath :: FilePath
  , broadcast :: Graph -> IO ()
  }

-- Effect that needs environment
type DBIO a = Reader GraphEnv (IO a)

-- Clean signature - no environment parameter!
apply_graph_updates :: Graph -> Action -> (Graph, DBIO ())
apply_graph_updates graph action =
  let newGraph = applyAction graph action
      dbEffect = do  -- In Reader monad
        env <- ask  -- Get environment
        liftIO $ persistToFS (vaultPath env) action
  in (newGraph, dbEffect)

-- Usage
main = do
  let env = GraphEnv "/vault/path" broadcastFn
  let (newGraph, dbEffect) = apply_graph_updates graph action
  runReader dbEffect env  -- Provide environment
```

### The Pattern in TypeScript

```typescript
// Environment type
interface GraphEnv {
  readonly vaultPath: string
  readonly broadcast: (graph: Graph) => void
}

// DBIO is a function that reads environment then executes
type DBIO<A> = (env: GraphEnv) => Promise<A>
type UIIO<A> = (env: GraphEnv) => Promise<A>

// Clean signature - no currying, no config parameter!
export function apply_graph_updates(
  graph: Graph,
  action: NodeAction
): readonly [Graph, DBIO<void>] {

  const newGraph = applyAction(graph, action)

  // DBIO is a function waiting for environment
  const dbEffect: DBIO<void> = async (env: GraphEnv) => {
    // Environment provided at execution time, not definition time!
    await persistToFS(env.vaultPath, action)
  }

  return [newGraph, dbEffect] as const
}

// Usage in main.ts
const env: GraphEnv = {
  vaultPath: currentVaultPath,  // Can change!
  broadcast: (g) => mainWindow.webContents.send('graph:stateChanged', g)
}

const [newGraph, dbEffect] = apply_graph_updates(graph, action)
await dbEffect(env)  // Provide environment at execution time
```

## Why This is Better

### 1. **Environment Can Change**
```typescript
// User switches to new vault
const newEnv: GraphEnv = {
  vaultPath: newVaultPath,
  broadcast
}

// Same function, different environment!
const [graph2, effect2] = apply_graph_updates(graph1, action)
await effect2(newEnv)  // Uses new vault path
```

### 2. **Clean Function Signatures**
```typescript
// Before (curried - confusing)
apply_graph_updates :: string -> (Graph -> Action -> [Graph, DBIO])

// After (Reader - clean!)
apply_graph_updates :: Graph -> Action -> [Graph, DBIO]
```

### 3. **Easy Testing**
```typescript
// Test with mock environment
const testEnv: GraphEnv = {
  vaultPath: '/tmp/test',
  broadcast: vi.fn()
}

const [newGraph, effect] = apply_graph_updates(graph, action)
await effect(testEnv)  // Tests use test env

expect(testEnv.broadcast).toHaveBeenCalled()
```

### 4. **Explicit Dependencies**
```typescript
// Dependencies are visible in the type system
type DBIO<A> = (env: GraphEnv) => Promise<A>
//               ^^^^^^^^^^^^
//               Dependencies declared here!

// Not hidden in closures
```

### 5. **Composable Effects**
```typescript
// Effects can be combined before execution
const effect1: DBIO<void> = ...
const effect2: DBIO<void> = ...

const combined: DBIO<void> = async (env) => {
  await effect1(env)
  await effect2(env)
}

// Execute combined effect with same environment
await combined(env)
```

## Implementation Plan

### Step 1: Define GraphEnv Type

**File:** `src/graph-core/functional/types.ts`

```typescript
/**
 * Environment/configuration for graph operations
 * This is the Reader monad's environment
 */
export interface GraphEnv {
  readonly vaultPath: string
  readonly broadcast: (graph: Graph) => void
}

/**
 * Database IO effect - reads environment then executes IO
 * This is a Reader monad: GraphEnv -> IO<A>
 */
export type DBIO<A = void> = (env: GraphEnv) => Promise<A>

/**
 * UI IO effect - reads environment then executes IO
 * This is a Reader monad: GraphEnv -> IO<A>
 */
export type UIIO<A = void> = (env: GraphEnv) => Promise<A>
```

### Step 2: Refactor apply_graph_updates

**File:** `src/graph-core/functional/applyGraphActionsToDB.ts`

```typescript
// Remove currying, return to simple signature
export function apply_graph_updates(
  graph: Graph,
  action: NodeAction
): readonly [Graph, DBIO<void>] {

  switch (action.type) {
    case 'CreateNode': {
      const newGraph = applyCreateNode(graph, action)

      // Effect asks for environment when executed
      const dbEffect: DBIO<void> = async (env: GraphEnv) => {
        const filename = `${action.nodeId}.md`
        const filepath = path.join(env.vaultPath, filename)
        await fs.writeFile(filepath, action.content, 'utf-8')
      }

      return [newGraph, dbEffect] as const
    }

    // Similar for UpdateNode, DeleteNode
  }
}
```

### Step 3: Refactor apply_db_updates_to_graph

**File:** `src/graph-core/functional/applyFSEventToGraph.ts`

```typescript
// Remove currying
export function apply_db_updates_to_graph(
  graph: Graph,
  fsUpdate: FSUpdate
): readonly [Graph, UIIO<void>] {

  switch (fsUpdate.eventType) {
    case 'Added': {
      const newGraph = applyAddedEvent(graph, fsUpdate)

      // Effect asks for broadcast when executed
      const uiEffect: UIIO<void> = async (env: GraphEnv) => {
        env.broadcast(newGraph)
      }

      return [newGraph, uiEffect] as const
    }

    // Similar for Changed, Deleted
  }
}
```

### Step 4: Update main.ts to Provide Environment

**File:** `electron/main.ts`

```typescript
// Create environment once
let currentVaultPath = '/path/to/vault'

const createEnv = (): GraphEnv => ({
  vaultPath: currentVaultPath,
  broadcast: (graph: Graph) => {
    BrowserWindow.getAllWindows().forEach(win => {
      win.webContents.send('graph:stateChanged', graph)
    })
  }
})

// USER ACTIONS
ipcMain.handle('graph:createNode', async (event, action: CreateNode) => {
  const [newGraph, dbEffect] = apply_graph_updates(currentGraph, action)

  await dbEffect(createEnv())  // Provide environment
  currentGraph = newGraph
})

// When vault changes
ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })

  if (!result.canceled) {
    currentVaultPath = result.filePaths[0]  // Update environment!

    // Reload graph with new environment
    currentGraph = await loadGraphFromDisk(currentVaultPath)()
  }
})
```

### Step 5: Update Tests

**File:** `tests/unit/graph-core/functional/apply-graph-updates.test.ts`

```typescript
describe('apply_graph_updates', () => {
  const testEnv: GraphEnv = {
    vaultPath: '/tmp/test-vault',
    broadcast: vi.fn()
  }

  it('should create a new node in the graph', async () => {
    const action: CreateNode = {
      type: 'CreateNode',
      nodeId: '1',
      content: '# Test',
      position: none
    }

    const [newGraph, dbEffect] = apply_graph_updates(emptyGraph, action)

    expect(newGraph.nodes['1']).toBeDefined()

    // Execute effect with test environment
    await dbEffect(testEnv)
  })
})
```

## Benefits Summary

| Aspect | Currying (Current) | Reader Monad (Proposed) |
|--------|-------------------|------------------------|
| **Signature** | Confusing, 2-step | Clean, 1-step |
| **Environment** | Fixed in closure | Dynamic at execution |
| **Testing** | Need to curry with test values | Just pass test env |
| **Vault switching** | Impossible | Easy |
| **FP idiomatic** | No | Yes ✓ |
| **Type safety** | Hidden dependencies | Explicit in types |
| **Composability** | Hard | Easy |

## Migration Strategy

1. ✅ Define `GraphEnv` type
2. ✅ Update `DBIO` and `UIIO` type definitions
3. ✅ Refactor `apply_graph_updates` (remove currying)
4. ✅ Refactor `apply_db_updates_to_graph` (remove currying)
5. ✅ Update all tests to pass test environment
6. ✅ Update `main.ts` to create and pass environment
7. ✅ Update handlers to use environment
8. ✅ Run all tests - should pass with 105/105
9. ✅ Run ESLint - should still pass (0 errors)

## Success Criteria

- ✓ All 105 tests pass
- ✓ ESLint shows 0 errors
- ✓ Function signatures are clean (no currying)
- ✓ Environment can be changed dynamically
- ✓ Tests use mock environments easily
- ✓ Type system makes dependencies explicit

## Next Steps After This Task

This is a prerequisite for:
- Phase 3b: Integrate into VoiceTreeGraphView
- Multi-vault support
- Undo/redo (need to replay actions with different environments)
- Testing with different configurations
