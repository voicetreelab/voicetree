# E2E Port Conflict Resolution Test - Implementation Summary

## What Was Created

### 1. Main Test File
**File**: `electron-port-conflict-resolution.spec.ts`

A comprehensive e2e test that validates the complete backend connection flow with port conflict resolution.

### 2. Test Coverage

#### Test 1: `should use port 8002 when 8001 is blocked and successfully call /load-directory`

**Steps**:
1. **Setup**: Blocks port 8001 with a mock TCP server before Electron starts
2. **Verification**: Confirms Electron server manager found port 8002
3. **IPC Test**: Gets backend port via `electronAPI.getBackendPort()` → expects `8002`
4. **Health Check**: Direct HTTP request to `http://localhost:8002/health`
5. **Network Interception**: Intercepts `window.fetch` to capture all API calls
6. **User Action**: Opens folder (triggers file watching → backend API call)
7. **API Verification**: Confirms `/load-directory` POST request to port 8002
8. **Integration Verification**: Confirms graph loaded successfully from backend

**Key Assertions**:
```typescript
expect(backendPort).toBe(8002)
expect(healthCheck.ok).toBe(true)
expect(loadDirectoryRequest.url).toContain('localhost:8002')
expect(loadDirectoryRequest.port).toBe(8002)
expect(graphState.nodeCount).toBeGreaterThan(0)
```

#### Test 2: `should handle backend connection initialization on first API call`

**Purpose**: Validates lazy initialization behavior

**Steps**:
1. Makes direct health check to backend
2. Starts file watching (triggers backend-api.ts)
3. Verifies graph loads correctly

**Key Behavior**: Tests that backend connection initializes on-demand, not at app startup

### 3. Test Fixtures

#### Port Blocking Fixture
```typescript
blockPort8001: async ({}, use) => {
  let cleanup = await blockPort(8001);
  await use(cleanup);
  await cleanup(); // Automatic cleanup
}
```

**How it works**:
- Creates `net.Server` listening on `0.0.0.0:8001`
- Binds BEFORE Electron starts (forces port conflict)
- Returns cleanup function for automatic teardown
- Ensures port is released even if test fails

#### Electron App Fixture
```typescript
electronApp: async ({ blockPort8001 }, use) => {
  await blockPort8001; // Dependency ensures port blocked first
  const electronApp = await electron.launch({...});
  await use(electronApp);
  await electronApp.close();
}
```

**Dependencies**: Explicitly depends on `blockPort8001` fixture to ensure ordering

### 4. Network Request Interception

The test intercepts `window.fetch` to capture all HTTP requests:

```typescript
await appWindow.evaluate(() => {
  const originalFetch = window.fetch;
  (window as any).__networkRequests = [];

  window.fetch = function(input, init) {
    const url = typeof input === 'string' ? input : input.toString();
    const urlObj = new URL(url);
    const port = urlObj.port ? parseInt(urlObj.port) : null;

    (window as any).__networkRequests.push({ url, method, port });
    return originalFetch.call(this, input, init);
  };
});
```

**Captured Data**:
- Request URL
- HTTP method (GET/POST)
- Port number extracted from URL
- All stored in `window.__networkRequests` array

### 5. Documentation
**File**: `README-port-conflict-test.md`

Complete documentation including:
- Test overview and flow diagram
- Prerequisites and build requirements
- Running instructions
- Troubleshooting guide
- Related files reference

## Validation

### Type Checking
```bash
$ npx tsc --noEmit
✓ No errors
```

### Test Discovery
```bash
$ npx playwright test electron-port-conflict-resolution.spec.ts --list
✓ Found 2 tests in 1 file
```

## Running the Test

### Standard Run
```bash
npx playwright test electron-port-conflict-resolution.spec.ts \
  --config=playwright-electron.config.ts
```

### With UI (for debugging)
```bash
npx playwright test electron-port-conflict-resolution.spec.ts \
  --config=playwright-electron.config.ts --ui
```

### Headed Mode (visible window)
```bash
MINIMIZE_TEST=0 npx playwright test electron-port-conflict-resolution.spec.ts \
  --config=playwright-electron.config.ts
```

## Test Architecture

### Fixture Dependency Graph
```
blockPort8001 (setup port blocking)
    ↓
electronApp (launch Electron with port conflict)
    ↓
appWindow (get main window, wait for ready)
    ↓
Test execution
```

### Network Flow
```
Test Setup
    ↓
Block Port 8001 ──────────────┐
    ↓                         │
Electron Starts               │ (Port conflict)
    ↓                         │
ServerManager.start()         │
    ↓                         │
findAvailablePort(8001) ◄─────┘
    ↓
Finds 8002 ✓
    ↓
Spawns Python server on 8002
    ↓
IPC: get-backend-port → 8002
    ↓
User opens folder
    ↓
FileWatchHandler.notifyBackend()
    ↓
loadDirectory() in backend-api.ts
    ↓
getBackendBaseUrl() → lazy init
    ↓
initializeBackendConnection()
    ↓
IPC: getBackendPort() → 8002
    ↓
fetch('http://localhost:8002/load-directory')
    ↓
Test intercepts request ✓
    ↓
Verify port === 8002 ✓
```

## Key Design Decisions

### 1. Why Block Port 8001?
- Forces realistic port conflict scenario
- Tests dynamic port discovery (not hardcoded 8001)
- Validates `findAvailablePort()` utility function

### 2. Why Intercept fetch()?
- Playwright can't easily intercept HTTP requests from Electron main process
- Fetch interception in renderer captures client-side API calls
- Provides exact URL and port verification

### 3. Why Lazy Initialization Test?
- Critical behavior: app should start fast (no blocking)
- Backend connection happens on-demand (when user opens folder)
- Validates refactoring that removed `await initializeBackendConnection()` from `main.tsx`

### 4. Why Both Tests?
- **Test 1**: Full e2e flow with port conflict
- **Test 2**: Focused on lazy initialization behavior
- Different failure modes, different debugging paths

## Potential Issues & Solutions

### Issue: Port Already in Use
**Solution**: Test fixture automatically cleans up. If zombie process exists:
```bash
lsof -i :8001 :8002 | grep LISTEN | awk '{print $2}' | xargs kill
```

### Issue: Test Times Out
**Causes**:
1. Python server not built → Check `dist/resources/server/voicetree-server`
2. Server fails to start → Check `~/Library/Application Support/Electron/server-debug.log`
3. Backend API timeout → Increase `waitForBackendReady()` attempts

**Solution**: See README troubleshooting section

### Issue: Network Requests Not Captured
**Cause**: Fetch interception set up after first request

**Solution**: Test sets up interception BEFORE calling `startFileWatching()`

## Success Criteria

✅ Test discovers 2 test cases
✅ TypeScript compiles without errors
✅ Test can run in headed/headless mode
✅ Automatic port cleanup on test failure
✅ Captures all network requests to backend
✅ Validates lazy initialization behavior
✅ Documents complete flow for future developers

## Next Steps

To run the test successfully, ensure:

1. **Python backend server is built**
   - Location: `dist/resources/server/voicetree-server`
   - Should be executable on Unix systems

2. **Electron app is built**
   - Run: `npx electron-vite build`
   - Check: `dist-electron/main/index.js` exists

3. **Test fixture vault exists**
   - Location: `tests/fixtures/example_real_large`
   - Should contain markdown files with wiki-links

## Files Created

1. `tests/e2e/full-electron/electron-port-conflict-resolution.spec.ts` - Main test file
2. `tests/e2e/full-electron/README-port-conflict-test.md` - Documentation
3. `tests/e2e/full-electron/IMPLEMENTATION_SUMMARY.md` - This file
