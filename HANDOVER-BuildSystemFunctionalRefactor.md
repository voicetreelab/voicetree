# HANDOVER: Functional Build System Refactor

**Date:** 2025-11-03
**Context:** Analysis of current VoiceTree build system and proposal for functional refactor

---

## Current Build System (Procedural/Imperative)

### How It Works Now

The build system consists of shell scripts that execute sequentially:

**Main Script:** `build_and_package_all.sh`

```bash
# Sequential Steps (Imperative):

1. Validate location (check server.py exists)
   ↓
2. Call build_server.sh:
   - Create .venv-server
   - Install dependencies
   - Run PyInstaller
   - Copy binary to dist/resources/server/
   ↓
3. Validate server binary exists
   ↓
4. Copy tools/* → dist/resources/tools/
   ↓
5. Copy backend modules → dist/resources/backend/
   ↓
6. cd frontend/webapp
   ↓
7. Check/install node_modules
   ↓
8. npm run build:test (TypeScript compile)
   ↓
9. cd ../..
   ↓
10. rm -rf dist/electron
   ↓
11. cd frontend/webapp
   ↓
12. npm run electron:dist (electron-builder)
   ↓
13. Report results
```

### Current Problems

- ❌ **State changes everywhere** (`cd`, global directories)
- ❌ **Order matters** (tight coupling, implicit dependencies)
- ❌ **No parallelism** (sequential only)
- ❌ **No caching** (rebuilds everything every time)
- ❌ **Hard to test** (shell scripts with side effects)
- ❌ **Fail-fast only** (`set -e` - can't collect all errors)
- ❌ **Directory navigation fragility** (multiple `cd` commands)
- ❌ **Dev vs Prod logic mixed** (hard to reason about)

### Current Build Flow Diagram

```
IMPERATIVE (Current)
════════════════════

[Step 1: Validate] ─────────────>
    │
    ▼
[Step 2: Build Python Binary] ──>
    │
    ▼
[Step 3: Validate Binary] ──────>
    │
    ▼
[Step 4: Copy Tools] ───────────>
    │
    ▼
[Step 5: Copy Backend] ─────────>
    │
    ▼
[Step 6: cd frontend/webapp] ───>
    │
    ▼
[Step 7: Install npm deps] ─────>
    │
    ▼
[Step 8: Build TypeScript] ─────>
    │
    ▼
[Step 9: cd ../..] ─────────────>
    │
    ▼
[Step 10: Clean dist/electron] ─>
    │
    ▼
[Step 11: cd frontend/webapp] ──>
    │
    ▼
[Step 12: electron:dist] ───────>
    │
    ▼
[Step 13: Report Results]

⚠️  State changes at every step!
⚠️  Must execute in exact order!
⚠️  No parallelism possible!
```

---

## Proposed Functional Build System

### Core Functional Principles

1. **Separate Description from Execution** (Free Monad pattern)
2. **Reader Monad for Dependencies** (Dependency Injection)
3. **Build Graph as Immutable Data**
4. **Content-Addressable Caching** (Nix-style)
5. **Explicit Dependency Graph**

### High-Level Functional Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         BUILD GRAPH                              │
└─────────────────────────────────────────────────────────────────┘

                    ┌──────────────┐
                    │   BuildEnv   │  (Pure Config)
                    │              │
                    │ - nodeEnv    │
                    │ - rootDir    │
                    │ - isPackaged │
                    └──────┬───────┘
                           │
                           ▼
            ┌──────────────────────────────┐
            │  Compute Build Targets       │  (Pure Function)
            │  (Based on environment)      │
            └──────────────┬───────────────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼

┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Python    │    │   Tools     │    │ TypeScript  │
│   Server    │    │   & Backend │    │   Build     │
│             │    │             │    │             │
│ Inputs:     │    │ Inputs:     │    │ Inputs:     │
│ backend/**  │    │ tools/**    │    │ src/**      │
│ *.py        │    │ backend/*/  │    │ electron/** │
│             │    │             │    │             │
│ Output:     │    │ Output:     │    │ Output:     │
│ dist/..     │    │ dist/..     │    │ dist/       │
│ /server/    │    │ /tools/     │    │ dist-elect/ │
└──────┬──────┘    └──────┬──────┘    └──────┬──────┘
       │                  │                  │
       │    (Parallel!)   │    (Parallel!)   │
       └──────────────────┼──────────────────┘
                          │
                          ▼
                  ┌───────────────┐
                  │   Electron    │
                  │   Package     │
                  │               │
                  │ Depends on:   │
                  │ - Python      │
                  │ - Tools       │
                  │ - TypeScript  │
                  │               │
                  │ Output:       │
                  │ dist/electron │
                  └───────────────┘
```

### Key Functional Properties

```
┌────────────────────────────────────────────────────────────────┐
│ 1. PURE COMPUTATION (No side effects)                          │
│    ┌──────────┐          ┌──────────┐                         │
│    │ BuildEnv │  ─────>  │ BuildSpec│  (Deterministic)        │
│    └──────────┘          └──────────┘                         │
│                                                                 │
│ 2. DEPENDENCY GRAPH (Explicit)                                 │
│    ┌─────┐   depends on   ┌─────┐                             │
│    │  A  │ ────────────>  │  B  │  (Declared, not implicit)   │
│    └─────┘                └─────┘                             │
│                                                                 │
│ 3. PARALLEL EXECUTION (Auto-detected)                          │
│    ┌─────┐                ┌─────┐                             │
│    │  A  │                │  B  │  (Run simultaneously)        │
│    └──┬──┘                └──┬──┘                             │
│       └────────┬─────────────┘                                 │
│                ▼                                                │
│            ┌───────┐                                            │
│            │   C   │                                            │
│            └───────┘                                            │
│                                                                 │
│ 4. INCREMENTAL BUILDS (Content-addressed)                      │
│    ┌──────────────┐                                            │
│    │ Input Hash   │ ──> Cache Hit? ──> Skip Build             │
│    └──────────────┘                                            │
│                                                                 │
│ 5. SEPARATION OF CONCERNS                                      │
│    ┌──────────┐   ┌──────────┐   ┌──────────┐                │
│    │  What    │   │   How    │   │   When   │                │
│    │ (Spec)   │   │ (Execute)│   │ (Schedule)│                │
│    └──────────┘   └──────────┘   └──────────┘                │
└────────────────────────────────────────────────────────────────┘
```

### Functional Build Structure (Code Shape)

```typescript
// ============= LAYER 1: Pure Specifications =============

type BuildSpec = {
  readonly pythonServer: Option<CompileTarget>  // None in dev
  readonly tools: CopyTarget
  readonly backend: CopyTarget
  readonly typescript: CompileTarget
  readonly electronPackage: Option<PackageTarget>  // None in dev
}

const computeBuildSpec: Reader<BuildEnv, BuildSpec> = env => ({
  pythonServer: env.nodeEnv === 'production'
    ? some({
        inputs: ['backend/**/*.py'],
        output: 'dist/resources/server',
        build: runPyInstaller
      })
    : none,

  tools: {
    inputs: ['tools/**/*'],
    output: 'dist/resources/tools',
    copy: true
  },

  // ... etc
})


// ============= LAYER 2: Dependency Graph =============

type BuildGraph = Map<TargetId, Set<TargetId>>  // Just data!

const graph: BuildGraph = new Map([
  ['python-server', new Set()],           // No deps
  ['tools', new Set()],                   // No deps
  ['typescript', new Set()],              // No deps
  ['electron-package', new Set([          // Depends on all
    'python-server',
    'tools',
    'typescript'
  ])]
])


// ============= LAYER 3: Execution Strategy =============

// Topological sort gives execution order
const executionPlan = topologicalSort(graph)
// Result: [
//   [python-server, tools, typescript],  // Parallel batch 1
//   [electron-package]                   // Sequential batch 2
// ]

// Execute each batch in parallel, batches sequentially
const executeBuild = (
  plan: Target[][]
): TaskEither<BuildError, void> =>
  pipe(
    plan,
    A.traverse(TE.ApplicativeSeq)(batch =>  // Batches sequential
      pipe(
        batch,
        A.traverse(TE.ApplicativePar)(buildTarget)  // Within batch: parallel!
      )
    )
  )


// ============= LAYER 4: Caching =============

const buildWithCache = <A>(
  target: Target,
  build: TaskEither<Error, A>
): Reader<Cache, TaskEither<Error, A>> => cache => {
  const inputHash = hashInputs(target.inputs)
  const cached = cache.get(target.id, inputHash)

  return cached
    ? TE.right(cached.result)  // Cache hit!
    : pipe(
        build,
        TE.tap(result => cache.set(target.id, inputHash, result))
      )
}


// ============= LAYER 5: Public API =============

// Dev mode: Skip Python compile, run from source
export const devBuild = pipe(
  createBuildEnv({ nodeEnv: 'development' }),
  R.chain(env => executeBuild(
    computeBuildSpec(env),
    ['tools', 'typescript']  // Only these targets
  ))
)

// Prod mode: Full build
export const prodBuild = pipe(
  createBuildEnv({ nodeEnv: 'production' }),
  R.chain(env => executeBuild(
    computeBuildSpec(env),
    ['electron-package']  // Triggers all dependencies
  ))
)
```

### Core Abstractions (High Level)

```typescript
// ============= 1. Build Target (What to build) =============
type BuildTarget = {
  readonly id: string
  readonly inputs: readonly Input[]   // What files/artifacts it needs
  readonly outputs: readonly Output[] // What it produces
  readonly buildFn: BuildFunction     // How to build it
}

type Input =
  | { type: 'SourceFiles', pattern: string }      // e.g., "backend/**/*.py"
  | { type: 'Artifact', targetId: string }        // Output from another target
  | { type: 'EnvVar', name: string }              // e.g., NODE_ENV

type Output =
  | { type: 'File', path: string }
  | { type: 'Directory', path: string }
  | { type: 'Artifact', name: string }            // Can be used by other targets

// ============= 2. Build Function (How to build) =============
// Reader for env, TaskEither for async effects with errors
type BuildFunction = Reader<BuildEnv, TaskEither<BuildError, BuildResult>>

type BuildEnv = {
  readonly rootDir: string
  readonly nodeEnv: 'development' | 'production' | 'test'
  readonly isPackaged: boolean
  readonly cache: Cache
  readonly logger: Logger
}

type BuildResult = {
  readonly artifacts: Map<string, string>  // name -> path
  readonly duration: number
}

// ============= 3. Build Graph (How targets relate) =============
type BuildGraph = {
  readonly targets: Map<string, BuildTarget>
  readonly edges: Map<string, Set<string>>  // targetId -> dependencies
}

// Pure function to compute build order
const topologicalSort = (graph: BuildGraph): Either<CycleError, BuildTarget[]>

// ============= 4. Executor (Run the build) =============
// Takes graph, returns effect that executes it
const executeBuild = (
  graph: BuildGraph,
  requestedTargets: string[]
): Reader<BuildEnv, TaskEither<BuildError, Map<string, BuildResult>>>
```

---

## Visual Comparison

### Side-by-Side Flow

```
IMPERATIVE (Current)              FUNCTIONAL (Proposed)
════════════════════              ════════════════════

[Step 1] ─────────────>           ┌─────────────┐
    │                             │   Config    │
    ▼                             │   (Pure)    │
[Step 2] ─────────────>           └──────┬──────┘
    │                                    │
    ▼                                    ▼
[Step 3] ─────────────>           ┌─────────────┐
    │                             │   Graph     │
    ▼                             │   (Data)    │
[Step 4] ─────────────>           └──────┬──────┘
    │                                    │
    ▼                                    ▼
[Step 5] ─────────────>           ┌─────────────┐
                                  │  Execute    │
State changes at                  │ (Interpret) │
every step!                       └─────────────┘

                                  Side effects only
                                  at the end!
```

### Feature Comparison

| Aspect | Procedural | Functional |
|--------|-----------|------------|
| **Data Flow** | Implicit (globals, cwd) | Explicit (Reader) |
| **Execution** | Sequential | Parallel where possible |
| **Testability** | Hard (shell scripts) | Easy (inject env) |
| **Caching** | None | Content-addressable |
| **Errors** | Fail fast (set -e) | Collect all (Validation) |
| **Composability** | Copy-paste scripts | Compose functions |
| **Reasoning** | Must trace execution | Read the graph |
| **Dev vs Prod** | Mixed logic | Pure function selects |

---

## Dev vs Prod: How to Encode Runtime Differences

### Problem: Different Execution in Different Modes

- **Dev mode:** Run `python server.py` directly
- **Prod mode:** Run compiled binary `voicetree-server`

### Solution: Runtime Strategies (Strategy Pattern)

```typescript
// ============= Runtime Strategies =============

interface ServerStrategy {
  readonly name: string
  readonly build: BuildTarget | null  // null = no build needed
  readonly launch: Reader<BuildEnv, TaskEither<Error, ServerProcess>>
}

// Development strategy: run Python directly
const devServerStrategy: ServerStrategy = {
  name: 'python-direct',
  build: null,  // No compilation needed!
  launch: env => pipe(
    validatePythonInstalled(),
    TE.chain(() => TE.tryCatch(
      () => spawn('python', ['server.py'], {
        cwd: path.join(env.rootDir, 'backend'),
        env: { ...process.env, PYTHONUNBUFFERED: '1' }
      }),
      E.toError
    ))
  )
}

// Production strategy: run compiled binary
const prodServerStrategy: ServerStrategy = {
  name: 'compiled-binary',
  build: {
    id: 'python-server',
    inputs: [{ type: 'SourceFiles', pattern: 'backend/**/*.py' }],
    outputs: [{ type: 'File', path: 'dist/resources/server/voicetree-server' }],
    buildFn: () => runPyInstaller()
  },
  launch: env => {
    const binaryPath = env.isPackaged
      ? path.join(process.resourcesPath, 'server', 'voicetree-server')
      : path.join(env.rootDir, 'dist', 'resources', 'server', 'voicetree-server')

    return pipe(
      validateBinaryExists(binaryPath),
      TE.chain(() => TE.tryCatch(
        () => spawn(binaryPath, [], { cwd: env.rootDir }),
        E.toError
      ))
    )
  }
}

// Test strategy: use stub server
const testServerStrategy: ServerStrategy = {
  name: 'stub-server',
  build: null,
  launch: env => TE.right(createStubServer())  // Mock server
}

// ============= Strategy Selection =============

const selectServerStrategy: Reader<BuildEnv, ServerStrategy> = env => {
  if (env.nodeEnv === 'test') return testServerStrategy
  if (env.nodeEnv === 'development') return devServerStrategy
  return prodServerStrategy
}

// ============= Unified Server Launcher =============

const startServer: Reader<BuildEnv, TaskEither<Error, ServerProcess>> = env => {
  const strategy = selectServerStrategy(env)

  return pipe(
    // 1. Build if needed
    strategy.build
      ? executeBuild(createGraph([strategy.build]), [strategy.build.id])(env)
      : TE.right(new Map()),

    // 2. Launch
    TE.chain(() => strategy.launch(env))
  )
}
```

---

## Migration Strategy

### Incremental Approach (Don't Rewrite Everything!)

**Phase 1: Extract Path Computation to Pure Functions**
- Move path logic out of shell scripts into TypeScript
- Create `BuildEnv` type and `computePaths` function
- Test independently

**Phase 2: Wrap File Operations in TaskEither**
- Add error handling with fp-ts
- Replace try/catch with TaskEither
- Maintain same behavior, better types

**Phase 3: Build Operation Lists as Data**
- Define build targets as data structures
- Create dependency graph
- Still execute imperatively for now

**Phase 4: Add Caching Layer**
- Implement content-addressable cache
- Hash inputs before building
- Skip builds when inputs unchanged

**Phase 5: Parallel Execution**
- Topological sort on graph
- Execute independent targets in parallel
- Full functional build system!

---

## Benefits Summary

### Functional Build System Advantages

1. **Composability**: Mix and match targets for different scenarios
2. **Testability**: Can mock BuildEnv, inject test file system
3. **Parallelism**: Automatically parallelizes independent targets
4. **Incremental**: Only rebuilds changed targets
5. **Declarative**: Graph is just data, can visualize/analyze it
6. **Type-Safe**: Compiler ensures dependencies exist
7. **Error Handling**: Collects all errors, doesn't fail fast
8. **Separation of Concerns**: Build vs Runtime vs Config are separate
9. **Reproducible**: Same env → same spec → same operations
10. **Observable**: Can log/inspect graph before executing

### Current Pain Points Solved

- ✅ **No more `cd` fragility** - paths computed from env
- ✅ **Dev/Prod separation** - pure function selects strategy
- ✅ **Parallelism** - auto-detected from graph
- ✅ **Incremental builds** - content-addressable caching
- ✅ **Testability** - inject mock environment
- ✅ **Error collection** - see all failures, not just first

---

## Next Steps

1. **Create core build system abstractions** (`BuildTarget`, `BuildGraph`, etc.)
2. **Refactor `tools-setup.ts`** into functional architecture
3. **Define VoiceTree build graph** with all targets
4. **Implement graph executor** with parallel execution
5. **Add caching layer** for incremental builds
6. **Replace shell scripts** with TypeScript implementations
7. **Add visualization** of build graph for debugging

---

## References

- **Current build scripts:**
  - `build_and_package_all.sh` - Main orchestrator
  - `build_server.sh` - Python binary compilation
- **Related issue:** Terminal spawn location (fixed by ensuring tools directory exists)
- **Philosophy:** VoiceTree development philosophy emphasizes functional design, no fallbacks, minimal complexity
