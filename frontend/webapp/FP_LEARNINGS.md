# Functional Programming Learnings & Common Mistakes

## Core Principles

### 1. Effects Are Descriptions, Not Executions

**WRONG:**
```typescript
function saveFile(absolutePath: string, content: string): void {
  fs.writeFileSync(absolutePath, content)  // Executes immediately!
}
```

**RIGHT:**
```typescript
function saveFile(absolutePath: string, content: string): AppEffect<void> {
  return (env: Env) => TE.tryCatch(
    async () => await fs.writeFile(absolutePath, content),
    toError
  )
  // Returns a DESCRIPTION, doesn't execute!
}
```

### 2. Pure Functions Cannot Execute Side Effects

**WRONG:**
```typescript
function handleAdded(env: Env, graph: Graph): Graph {
  const updatedGraph = { ...graph, newNode }
  env.broadcast(updatedGraph)  // 🚨 SIDE EFFECT IN PURE FUNCTION!
  return updatedGraph
}
```

**RIGHT:**
```typescript
// Pure function - just returns new graph
function handleAdded(env: Env, graph: Graph): Graph {
  const updatedGraph = { ...graph, newNode }
  return updatedGraph  // No side effects!
}

// Impure shell executes side effects
const newGraph = handleAdded(env, graph)
setGraph(newGraph)
env.broadcast(newGraph)  // Side effect in impure shell
```

### 3. The Impure Shell Executes Effects

**Where effects execute:**
- ✅ In handlers (IPC, file watchers)
- ✅ In `main` (Haskell equivalent)
- ✅ At the application boundary
- ❌ NEVER inside pure functions

**Pattern:**
```typescript
// Pure layer: Build effect description
const effect: AppEffect<Graph> = apply_graph_deltas(graph, action)

// Impure shell: Execute the effect
const result = await effect(env)()
//                   ^^^  Provide environment (Reader)
//                       ^^ Execute async computation (TaskEither)
```

## Common Mistakes We Encountered

### Mistake 1: Side Effects Inside "Pure" Functions

**What we did wrong:**
```typescript
// applyFSEventToGraph.ts - Claims to be pure!
export function apply_db_updates_to_graph(graph, update): EnvReader<Graph> {
  return (env: Env) => {
    const newGraph = updateGraph(graph, update)
    env.broadcast(newGraph)  // 🚨 EXECUTING side effect!
    return newGraph
  }
}
```

**Why it's wrong:**
- The function EXECUTES the broadcast, not just describes it
- Breaks referential transparency
- Can't test without actual broadcast
- Not pure!

**Correct approach:**
```typescript
// Pure function - no broadcast
export function apply_db_updates_to_graph(graph, update): EnvReader<Graph> {
  return (env: Env) => {
    const newGraph = updateGraph(graph, update)
    return newGraph  // Just return graph
  }
}

// Impure shell - executes broadcast
const newGraph = effect(env)
setGraph(newGraph)
env.broadcast(newGraph)  // Broadcast here!
```

### Mistake 2: Confusing Effect Creation with Effect Execution

**Wrong thinking:**
"If I return an `IO` monad, it will auto-run"

**Reality:**
- IO/Reader/AppEffect are just VALUES (descriptions)
- They don't run until the impure shell executes them
- Even in Haskell, only `main` executes IO

**Example:**
```typescript
const effect1 = loadFile('a.txt')  // Nothing happens!
const effect2 = loadFile('a.txt')  // Still nothing!
const effect3 = loadFile('a.txt')  // Just creating values

// Only when executed:
await effect1(env)()  // NOW it reads the file
```

### Mistake 3: Returning Tuples Instead of Monadic Values

**Old pattern (pre-Reader):**
```typescript
function apply_graph_deltas(vaultPath: string) {
  return (graph, action) => {
    const newGraph = ...
    const dbEffect = ...
    return [newGraph, dbEffect]  // Tuple with separate effect
  }
}
```

**Reader pattern:**
```typescript
function apply_graph_deltas(graph, action): AppEffect<Graph> {
  return (env: Env) => TE.tryCatch(
    async () => {
      // Effect logic here
      return newGraph  // Effect contains both computation and result
    },
    toError
  )
}
```

**Why Reader is better:**
- Environment passed at execution time, not definition time
- Composable (can chain multiple effects sharing same env)
- Standard FP pattern

### Mistake 4: Naming Confusion

**Problem:**
Using "apply" in both pure and impure layers:
- Pure: `apply_graph_deltas()` - builds effect description
- Impure: `applyDBAction()` - executes effect

**Causes confusion** about which layer you're in.

**Better naming:**
- Pure layer: Keep current names (they describe what they do)
- Impure shell: Just use handlers directly (they ARE the shell)
- Don't create extra `apply*` functions in impure layer

### Mistake 5: Not Understanding Reader Execution

**Wrong:**
```typescript
const effect = apply_graph_deltas(graph, action)
const result = await effect()  // ❌ Missing env!
```

**Right:**
```typescript
const effect = apply_graph_deltas(graph, action)
//    ^^^^^^ This is: (env: Env) => TaskEither<Error, Graph>

const result = await effect(env)()
//                   ^^^^ Step 1: Provide env → TaskEither<Error, Graph>
//                          ^^ Step 2: Execute → Promise<Either<Error, Graph>>
```

**Understanding the types:**
- `AppEffect<A>` = `ReaderTaskEither<Env, Error, A>`
- Which is: `(env: Env) => TaskEither<Error, A>`
- Which is: `(env: Env) => () => Promise<Either<Error, A>>`

So execution is: `effect(env)()`

### Mistake 6: Using `broadcast` from Environment Inside Pure Functions

**Wrong approach:**
"Let's put `broadcast` in the environment, so pure functions can use it!"

**Problem:**
If pure functions CALL `env.broadcast()`, they're executing side effects!

**Correct usage:**
- Put `broadcast` in `Env` for TYPE SAFETY (so impure shell has it)
- Pure functions read from Env (like `env.vaultPath`) but DON'T CALL impure things
- Impure shell calls `env.broadcast()` after executing effects

**Pattern:**
```typescript
// Pure function can read vaultPath (just data)
return (env: Env) => TE.tryCatch(
  async () => {
    await fs.writeFile(env.vaultPath + '/file.md', content)
    //                 ^^^^^^^^^^^^^^ Reading data from env ✅
    return newGraph
  },
  toError
)

// Impure shell calls broadcast (side effect)
const newGraph = effect(env)
env.broadcast(newGraph)  // ✅ Side effect in shell, not pure function
```

## Architecture Rules

### Pure Layer (`src/functional_graph/pure/`)
- ✅ Build effect descriptions (return `AppEffect<A>` or `EnvReader<A>`)
- ✅ Transform data (graph updates, parsing)
- ✅ Read from environment (env.vaultPath)
- ❌ NEVER execute side effects (no broadcast, no setState)
- ❌ NEVER call impure functions from env

### Impure Shell (`electron/handlers/`)
- ✅ Execute effects by calling `effect(env)()`
- ✅ Manage global state (`setGraph()`)
- ✅ Call impure functions (`env.broadcast()`)
- ✅ Handle errors from effect execution
- ❌ Should NOT contain business logic (that's in pure layer)

## Testing Patterns

### Pure Functions (Easy!)
```typescript
const testEnv: Env = {
  vaultPath: '/tmp/test',
  broadcast: vi.fn()  // Mock, but won't be called in pure function
}

const effect = apply_graph_deltas(graph, action)
const result = await effect(testEnv)()

expect(E.isRight(result)).toBe(true)
expect(testEnv.broadcast).not.toHaveBeenCalled()  // Pure function doesn't call it!
```

### Impure Shell (Need mocks)
```typescript
const mockBroadcast = vi.fn()
const mockSetGraph = vi.fn()

await handler(action)  // Executes effects

expect(mockBroadcast).toHaveBeenCalledWith(expectedGraph)
expect(mockSetGraph).toHaveBeenCalled()
```

## Summary Checklist

Before writing FP code, ask:

1. **Is this function pure?**
   - If yes: Return effect description, don't execute
   - If no: Mark it clearly (put in handlers/)

2. **Am I executing a side effect?**
   - If yes: Am I in the impure shell? (handlers, main)
   - If no: Move execution to impure shell

3. **Am I calling `env.broadcast()` or similar?**
   - If inside pure function: WRONG! Move to impure shell
   - If in handler: OK!

4. **Am I returning an effect description or a result?**
   - Pure functions: Return `AppEffect<A>` or `EnvReader<A>`
   - Impure shell: Execute and use the result

5. **Can I test this without mocks?**
   - Pure functions: Yes! No mocks needed for core logic
   - Impure shell: No, need mocks for side effects

## Key Insight

**The golden rule of FP:**
> Pure functions describe what to do.
> Impure shell does it.

Separate **computation** (pure) from **execution** (impure).
