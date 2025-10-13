# Vitest CPU Spam Fix

## Problem Summary
Multiple Vitest instances were spawning and consuming 100% CPU, causing system instability and friction.

## Root Causes Identified

### 1. **Vitest Pool Configuration**
- Vitest by default uses a `threads` pool which can spawn multiple Node processes
- Without proper pooling limits, concurrent test runs created many simultaneous processes
- No file parallelism limits allowed tests to run in parallel without constraints

### 2. **PostToolUse Hook Triggering**
- The `.claude/hooks/test-runner.sh` runs on every `Edit` or `Write` operation
- If tests hang or run slowly, multiple edits can trigger overlapping vitest instances
- No timeout mechanism existed to kill hung processes

### 3. **File Watcher Interactions**
- Vite's file watcher can trigger multiple rebuilds
- Combined with test hooks, this creates a cascade of process spawning

## Implemented Fixes

### Fix 1: Vitest Configuration (`vite.config.ts`)
```typescript
test: {
  // Prevent CPU spam by limiting concurrent test execution
  pool: 'forks',
  poolOptions: {
    forks: {
      singleFork: true, // Use single fork to prevent multiple Node processes
    },
  },
  fileParallelism: false, // Run test files sequentially
  testTimeout: 10000, // 10 second timeout per test
  hookTimeout: 5000, // 5 second timeout for hooks
}
```

**Key Changes:**
- `pool: 'forks'` + `singleFork: true` → Ensures only ONE Node process for all tests
- `fileParallelism: false` → Tests run sequentially, preventing parallel execution
- `testTimeout` → Prevents individual tests from hanging
- `hookTimeout` → Prevents test hooks (setup/teardown) from hanging

### Fix 2: Test Hook Timeout (`.claude/hooks/test-runner.sh`)
```bash
# Run vitest on matching test files with timeout
# Use timeout command to kill vitest if it runs too long (30 seconds)
test_output=$(timeout 30s npx vitest run $test_files 2>&1)
test_code=$?

# If timeout occurred (exit code 124), treat as failure
if [ $test_code -eq 124 ]; then
    echo "Test timeout for $file_path - killed after 30 seconds" >&2
    exit 2
fi
```

**Key Changes:**
- Added `timeout 30s` to forcefully kill vitest after 30 seconds
- Detects timeout exit code (124) and reports it as a test failure
- Prevents zombie processes from accumulating

## How to Verify the Fix

### 1. Run a simple test to ensure it exits cleanly:
```bash
npx vitest run tests/unit/utils/coordinate-conversions.test.ts --config vite.config.ts
```

Expected: Test runs in <1 second and exits with code 0

### 2. Check for running vitest processes:
```bash
ps aux | grep vitest
```

Expected: No vitest processes after test completion

### 3. Monitor CPU during development:
```bash
top -o cpu | grep node
```

Expected: No sustained 100% CPU usage from Node processes

## Prevention Tips

1. **Kill stuck processes manually if needed:**
   ```bash
   pkill -9 -f vitest
   ```

2. **Temporarily disable test hooks during heavy editing:**
   Comment out the test-runner hook in `.claude/settings.local.json`

3. **Use focused test runs instead of watch mode:**
   ```bash
   npm run test:unit  # Runs once and exits
   ```
   Avoid: `npm run test:watch` during automated workflows

4. **Monitor for zombie processes:**
   ```bash
   lsof -i :51204  # Vitest default port
   ```

## Technical Details

### Why `singleFork: true` is Critical
- Vitest's default `threads` pool creates worker threads
- The `forks` pool with `singleFork` creates exactly ONE child process
- This prevents exponential process spawning when tests trigger file changes

### Why `fileParallelism: false` Matters
- Parallel test execution can cause race conditions in file watchers
- Sequential execution ensures predictable resource usage
- Critical when tests run automatically on file changes

### Timeout Values Chosen
- **10s test timeout**: Reasonable for unit tests (most run in <100ms)
- **5s hook timeout**: Setup/teardown should be fast
- **30s hook timeout**: Allows for slower integration tests but prevents infinite hangs

## Related Files
- `/Users/bobbobby/repos/VoiceTree/frontend/webapp/vite.config.ts` - Vitest configuration
- `/Users/bobbobby/repos/VoiceTree/frontend/webapp/.claude/hooks/test-runner.sh` - Test hook with timeout
- `/Users/bobbobby/repos/VoiceTree/frontend/webapp/.claude/settings.local.json` - Hook registration

## References
- [Vitest Pool Options](https://vitest.dev/config/#pooloptions)
- [Vitest File Parallelism](https://vitest.dev/config/#fileparallelism)
- Previous similar issue resolved with similar approach
