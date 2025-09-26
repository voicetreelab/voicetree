## Files Changed:

1. **Created `src/App-e2e-floating-editor.tsx`** - Self-contained React application with all test logic
2. **Created `floating-editor-e2e-test.html`** - HTML entry point for the E2E test
3. **Modified `vite.config.ts`** - Added build configuration for multiple entry points
4. **Modified `tests/e2e/floating-editor.spec.ts`** - Updated to navigate to the new test page
Fixed the state management bug in `src/components/floating-windows/context/FloatingWindowManager.tsx`:

1. **Modified `getHighestZIndex`** to accept windows array as parameter instead of using closure
2. **Fixed `openWindow`** to use functional state updates, ensuring it always works with latest state
3. **Fixed `bringToFront`** to use functional state updates
4. Removed stale `windows` dependencies from useCallback hooks

The fix ensures all state updates use the latest state through functional updates, preventing stale closure issues.
