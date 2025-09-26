### Handover Document: File-to-Graph Pipeline E2E Test Debugging

**1. Overall Goal and Problem**

* **Goal:** Fix the failing E2E tests for the file-to-graph pipeline behavioral tests
* **Problem:** Graph is not updating after file events are dispatched in the test environment
* **Tests Affected:** All 3 tests in `tests/e2e/file-to-graph-pipeline-behavioral.spec.ts` are failing

**2. Root Cause Identified**

The issue stems from how file events are being dispatched and handled:

* **Mock Electron API:** Located at `src/test/mock-electron-api.ts`, correctly listens for `CustomEvent` dispatches
* **Event Dispatch:** Tests dispatch events like `new CustomEvent('mock-file-created', { detail: { path, content }})`
* **Problem Point:** The `useGraphManager` hook in `src/hooks/useGraphManager.tsx` has two code paths:
  - Electron path: Uses `window.electronAPI.on('file-changed', ...)` etc.
  - Browser fallback: Uses manual file additions via `setFiles`

**3. Current State of Investigation**

* **Discovery:** The mock API is correctly set up and emitting events internally
* **Issue:** The `useGraphManager` hook doesn't have a way to connect to the mock API's internal events
* **Test Environment:** Tests run in browser mode (not Electron), so `window.electronAPI` exists but the event listeners in `useGraphManager` aren't receiving the mock events

**4. Solutions Attempted**

1. **Initial Approach:** Tried to understand why events weren't propagating
2. **Debug Mode:** Ran tests with `--debug` flag to inspect behavior
3. **Mock API Analysis:** Examined how the mock emits events vs how the real Electron API works

**5. Proposed Solution**

The mock Electron API needs to bridge its internal EventEmitter to the window.electronAPI interface:

```javascript
// In mock-electron-api.ts
class MockElectronAPI extends EventEmitter {
  on(event: string, callback: Function) {
    // Bridge to EventEmitter
    this.addListener(event, callback);
    return this;
  }

  off(event: string, callback: Function) {
    this.removeListener(event, callback);
    return this;
  }
}
```

**6. Files Modified/Examined**

* `src/test/mock-electron-api.ts` - Mock implementation
* `src/hooks/useGraphManager.tsx` - Main hook being tested
* `tests/e2e/file-to-graph-pipeline-behavioral.spec.ts` - Failing tests
* `vite.config.ts` - Test configuration

**7. Next Steps**

1. Implement the `on`/`off` methods in MockElectronAPI to properly bridge events
2. Verify that `useGraphManager` can now receive events from the mock
3. Run the behavioral tests to confirm graph updates work
4. Check if other E2E tests are affected by the same issue

**8. Test Commands**

```bash
# Run the specific failing test
npx playwright test tests/e2e/file-to-graph-pipeline-behavioral.spec.ts --project chromium

# Run in debug mode for inspection
npx playwright test tests/e2e/file-to-graph-pipeline-behavioral.spec.ts --project chromium --debug

# View test report
npx playwright show-report
```

**9. Technical Details**

The core issue is that the Electron IPC event system uses a different pattern than browser events:
- Electron: `ipcRenderer.on()` / `ipcMain.handle()`
- Mock: Needs to emulate this with EventEmitter
- Browser tests: Need the mock to properly expose the `on`/`off` interface

The fix should be minimal - just adding proper method signatures to the MockElectronAPI class to match the real Electron API's event handling interface.