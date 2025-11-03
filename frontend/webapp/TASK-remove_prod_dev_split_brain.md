# TASK: Remove Prod/Dev Split Brain Complexity

**Date:** 2025-11-03
**Status:** Proposed (Not Implemented)
**Context:** After implementing centralized `build-config.ts`, we identified that dev/prod mode switching still creates cognitive complexity

---

## Problem Statement

The cognitive load of managing dev vs prod modes is high because developers must constantly ask:
- "Am I in dev or prod mode?"
- "Where do files come from in this mode?"
- "Which Python execution model am I using?"

This creates **split brain** complexity where you need two mental models:
- **Dev:** Files in repo, Python runs directly from source, hot reload works
- **Prod:** Files bundled in app, compiled binary runs, immutable package

---

## Root Cause: Fundamentally Different Execution Models

The core issue is NOT just paths - it's **how Python runs**:

```
Dev:  python server.py         (interpreter + source code)
Prod: ./voicetree-server        (frozen PyInstaller binary)
```

This is an unavoidable difference. You CANNOT symlink your way out of it because:
- Dev needs `.py` files for hot reload and debugging
- Prod needs standalone binary for distribution (no Python required)

---

## Rejected Approaches

### ❌ Option 1: Docker-like Container Model

**Idea:** Dev mode also runs compiled binary, rebuilds incrementally on change.

```bash
npm run dev
  → Watches Python files
  → On change: PyInstaller rebuild (~2s)
  → Runs binary (same as prod)
```

**Rejected because:**
- 2-second rebuild on every Python change (vs instant with source)
- Can't use Python debugger (binary is opaque)
- Loses hot reload benefits
- Bad developer experience

---

### ❌ Option 2: Standardized Location Only

**Idea:** Runtime never knows dev vs prod, always looks in one location (`~/.voicetree/`).

```typescript
const VOICETREE_HOME = app.getPath('userData') + '/voicetree';

// Runtime - no conditionals!
const config = {
  toolsDir: path.join(VOICETREE_HOME, 'tools'),
  serverBinary: path.join(VOICETREE_HOME, 'server', 'voicetree-server')
};
```

**Rejected because:**
- Doesn't solve the fundamental problem: dev needs `python server.py`, not a binary
- Would require building binary even in dev mode
- Loses the main benefit of dev mode (fast iteration)

---

### ❌ Option 3: Protocol-Based Development

**Idea:** Dev mode doesn't spawn server at all - connects to external process.

```
Dev:
  Terminal 1: python server.py       (manual)
  Terminal 2: npm run electron       (connects to :8001)

Prod:
  Electron spawns binary internally
```

**Rejected because:**
- Two-terminal workflow is clunky
- Can't test integrated startup in dev
- Adds cognitive load ("did I start the Python server?")
- Doesn't match production behavior

---

### ❌ Option 4: OOP Strategy Pattern

**Idea:** Use classes/interfaces for polymorphism.

```typescript
interface ServerLauncher {
  start(port: number): Promise<ChildProcess>
}

class PythonSourceLauncher implements ServerLauncher { ... }
class CompiledBinaryLauncher implements ServerLauncher { ... }
```

**Rejected because:**
- VoiceTree uses **functional programming**, not OOP
- Classes add unnecessary indirection
- Goes against project philosophy

---

## ✅ Recommended Approach: Functional Sum Types

### Key Insight

**You CANNOT eliminate the split brain** (Python vs binary are fundamentally different).

**But you CAN:**
- ✅ Make it **explicit** (sum type)
- ✅ **Localize** it (one function decides)
- ✅ Make it **visible** (logging)
- ✅ Make rest of code **mode-agnostic** (pure functions)

### Design

```typescript
// ============= Pure Data (Sum Type) =============

type ServerStrategy =
  | { readonly type: 'python-source'; readonly pythonPath: string; readonly scriptPath: string; readonly cwd: string }
  | { readonly type: 'compiled-binary'; readonly binaryPath: string; readonly cwd: string }

// ============= Pure Function: Compute Strategy =============

const getServerStrategy = (env: BuildEnv): ServerStrategy => {
  if (env.nodeEnv === 'development') {
    return {
      type: 'python-source',
      pythonPath: 'python',
      scriptPath: path.join(env.rootDir, 'backend', 'server.py'),
      cwd: path.join(env.rootDir, 'backend')
    };
  }

  const binaryPath = env.isPackaged
    ? path.join(process.resourcesPath, 'server', 'voicetree-server')
    : path.join(env.rootDir, 'dist', 'resources', 'server', 'voicetree-server');

  return {
    type: 'compiled-binary',
    binaryPath,
    cwd: env.rootDir
  };
};

// ============= Pure Function: Strategy -> Spawn Args =============

const getSpawnArgs = (strategy: ServerStrategy, port: number): {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
} => {
  switch (strategy.type) {
    case 'python-source':
      return {
        command: strategy.pythonPath,
        args: [strategy.scriptPath, port.toString()],
        cwd: strategy.cwd
      };

    case 'compiled-binary':
      return {
        command: strategy.binaryPath,
        args: [port.toString()],
        cwd: strategy.cwd
      };
  }
};

// ============= Impure Function: Execute (at edge) =============

const launchServer = (strategy: ServerStrategy, port: number): ChildProcess => {
  const spawnArgs = getSpawnArgs(strategy, port);

  console.log(`🚀 Server mode: ${strategy.type}`);
  console.log(`   Command: ${spawnArgs.command} ${spawnArgs.args.join(' ')}`);

  return spawn(spawnArgs.command, spawnArgs.args as string[], {
    cwd: spawnArgs.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env
  });
};

// ============= Composition (Pure until final execution) =============

// Pure pipeline
const createServerLauncher = (env: BuildEnv) => (port: number): ChildProcess => {
  const strategy = getServerStrategy(env);      // Pure
  return launchServer(strategy, port);           // Impure (at edge)
};

// Usage
const env = createBuildEnv();                    // Impure (reads process/app)
const launch = createServerLauncher(env);        // Pure (returns function)
const serverProc = launch(8001);                 // Impure (spawns process)
```

---

## Functional Principles Applied

### 1. Sum Types over Polymorphism

```typescript
// NOT: interface ServerLauncher { start(): ChildProcess }
// YES: type ServerStrategy = { type: 'python-source' } | { type: 'compiled-binary' }
```

**Why:** Sum types are data, interfaces are OOP. Functional code operates on data.

### 2. Pure Functions for Logic

```typescript
// Given env, ALWAYS returns same strategy (pure)
const getServerStrategy = (env: BuildEnv): ServerStrategy => ...

// Given strategy, ALWAYS returns same args (pure)
const getSpawnArgs = (strategy: ServerStrategy, port: number) => ...
```

**Why:** Pure functions are:
- Testable (same input → same output)
- Composable (can chain them)
- Parallelizable (no hidden state)

### 3. Push Impurity to Edges

```typescript
// Pure: env -> strategy
getServerStrategy(env)

// Pure: strategy -> spawn args
getSpawnArgs(strategy, port)

// Impure: spawn args -> process (ONLY at edge!)
spawn(...)
```

**Why:** Isolate side effects to make code predictable. 90% of code is pure, 10% is impure at edges.

### 4. Higher-Order Functions

```typescript
// Returns a function (closure over env)
const createServerLauncher = (env: BuildEnv) => (port: number) => ...
```

**Why:** Functions that return functions enable partial application and composition.

---

## Benefits of This Approach

1. **Localized Complexity**
   - Mode decision happens in ONE function (`getServerStrategy`)
   - Rest of codebase is mode-agnostic

2. **Type-Safe**
   - Discriminated union (`type: 'python-source' | 'compiled-binary'`)
   - TypeScript ensures correct fields accessed

3. **Observable**
   - Console logs show which mode is active
   - Easy to debug: "Which strategy was selected?"

4. **Testable**
   - Can unit test each pure function
   - Can inject mock `BuildEnv` to test different modes

5. **Honest**
   - Doesn't pretend dev === prod
   - Makes the difference explicit in types

6. **Functional**
   - No classes, no interfaces
   - Just data flowing through pure functions
   - Impurity pushed to edges

---

## Updated BuildConfig Type

```typescript
// build-config.ts

export type ServerStrategy =
  | { readonly type: 'python-source'; readonly pythonPath: string; readonly scriptPath: string; readonly cwd: string }
  | { readonly type: 'compiled-binary'; readonly binaryPath: string; readonly cwd: string }

export type ToolsStrategy = {
  readonly source: string;
  readonly dest: string;
  readonly shouldCopy: boolean;
}

export type BuildConfig = {
  readonly server: ServerStrategy;
  readonly tools: ToolsStrategy;
  readonly backend: ToolsStrategy;
}

// Pure functions
const getServerStrategy = (env: BuildEnv): ServerStrategy => { ... }
const getToolsStrategy = (env: BuildEnv): ToolsStrategy => { ... }
const getBackendStrategy = (env: BuildEnv): ToolsStrategy => { ... }

export const getBuildConfig = (env: BuildEnv): BuildConfig => ({
  server: getServerStrategy(env),
  tools: getToolsStrategy(env),
  backend: getBackendStrategy(env)
});

// Helper: Convert strategy to spawn arguments (pure)
export const getSpawnArgs = (strategy: ServerStrategy, port: number) => {
  switch (strategy.type) {
    case 'python-source':
      return {
        command: strategy.pythonPath,
        args: [strategy.scriptPath, port.toString()] as const,
        cwd: strategy.cwd
      };

    case 'compiled-binary':
      return {
        command: strategy.binaryPath,
        args: [port.toString()] as const,
        cwd: strategy.cwd
      };
  }
};
```

---

## Implementation Plan

### Phase 1: Update build-config.ts
1. Add `ServerStrategy` sum type
2. Replace `pythonCommand`/`pythonArgs`/etc with `server: ServerStrategy`
3. Add `getSpawnArgs` helper function

### Phase 2: Update RealTextToTreeServerManager
1. Get `ServerStrategy` from config
2. Use `getSpawnArgs` to compute spawn arguments
3. Remove all conditional logic (already pure!)
4. Add logging to show which strategy is active

### Phase 3: Update Tests
1. Test `getServerStrategy` for dev/prod/packaged modes
2. Test `getSpawnArgs` for both strategy types
3. Verify correct spawn arguments in each case

### Phase 4: Documentation
1. Update README with strategy explanation
2. Add comments explaining sum type approach
3. Document when each strategy is used

---

## Example Usage After Refactor

```typescript
// In RealTextToTreeServerManager.ts

private async startInternal(): Promise<number> {
  const env = createBuildEnv();
  const config = getBuildConfig(env);
  const strategy = config.server;

  // Pure computation
  const spawnArgs = getSpawnArgs(strategy, port);

  // Observable
  console.log(`🚀 Server mode: ${strategy.type}`);
  console.log(`   Command: ${spawnArgs.command} ${spawnArgs.args.join(' ')}`);

  // Impure (at edge)
  this.serverProcess = spawn(
    spawnArgs.command,
    spawnArgs.args as string[],
    {
      cwd: spawnArgs.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env
    }
  );

  return port;
}
```

---

## Cognitive Load Comparison

### Before (Current)
```typescript
// Scattered conditionals everywhere
if (app.isPackaged) {
  serverPath = path.join(process.resourcesPath, 'server', 'voicetree-server');
} else {
  serverPath = path.join(projectRoot, 'dist', 'resources', 'server', 'voicetree-server');
}

// Wait, am I in dev or prod? What about Python source?
// Do I need to check NODE_ENV too?
```

**Mental model:** "Check multiple conditions, figure out paths, hope I got it right"

### After (Proposed)
```typescript
const strategy = config.server;
// strategy.type tells me everything

switch (strategy.type) {
  case 'python-source':  // Dev mode, clear!
  case 'compiled-binary': // Prod mode, clear!
}
```

**Mental model:** "Look at strategy.type, it's explicit"

---

## Summary

**Problem:** Dev vs Prod split brain creates cognitive complexity

**Root Cause:** Fundamentally different execution models (Python source vs binary)

**Solution:** Accept the difference, make it explicit with sum types, localize it to one function

**Approach:** Functional programming (pure functions + sum types + push impurity to edges)

**Not Implemented:** This is a proposed refactor, not yet applied to the codebase

**Next Steps:** Decide if this refactor is worth doing now, or defer until cognitive load becomes painful

---

## References

- Current implementation: `electron/build-config.ts`
- Server manager: `electron/server/RealTextToTreeServerManager.ts`
- Related: `HANDOVER-BuildSystemFunctionalRefactor.md`
- Project philosophy: `CLAUDE.md` - "FOLLOW FUNCTIONAL DESIGN. PUSH IMPURITY TO EDGES."
