# Editor Feedback Loop Bug - Test Documentation

## Bug Description

The markdown editor had a critical bug where user input was lost due to a feedback loop:

1. **User types content** (e.g., "Hello world") → onChange fires after 300ms debounce
2. **Content saved to filesystem** via `modifyNodeContentFromUI`
3. **Filesystem watcher detects change** → sends FSEvent back to UI
4. **updateFloatingEditors receives the event** and calls `editor.setValue()`
5. **Editor content is overwritten** with stale content from step 2

The problem occurs when the user continues typing AFTER the debounced save fires but BEFORE the filesystem event arrives. The editor would be reset to the stale content, losing the user's additional typing.

## Example Timeline

```
t=0ms:   User types "Hello world"
t=50ms:  User continues typing " and more"
t=300ms: Debounce fires, saves "Hello world" to filesystem
t=400ms: Filesystem event arrives with "Hello world"
         → Editor is reset, losing " and more" ❌
```

## The Fix

The fix uses an `awaitingUISavedContent` Map to track content that was saved from the UI:

### Files Modified

1. **FloatingWindowManager.ts** (lines 48, 148-153)
   - Added `awaitingUISavedContent: Map<NodeId, string>` to track our own saves
   - In `updateFloatingEditors()`: Check if incoming content matches what we just saved
   - If it matches, ignore it to prevent the feedback loop
   - Clean up the map entry after processing

2. **cytoscape-floating-windows.ts** (lines 344, 394-395)
   - Accept `awaitingUISavedContent` parameter in `createFloatingEditor()`
   - Store content in the map when `onChange` fires, before calling `modifyNodeContentFromUI()`

### Key Code

```typescript
// In createFloatingEditor - Store content before saving
editor.onChange(async (newContent) => {
    console.log('[createAnchoredFloatingEditor] Saving editor content for node:', nodeId);
    // Track this content so we can ignore it when it comes back from filesystem
    awaitingUISavedContent.set(nodeId, newContent);
    await modifyNodeContentFromUI(nodeId, newContent, cy);
});

// In updateFloatingEditors - Ignore our own saves
if (editorId) {
    const awaiting = this.awaitingUISavedContent.get(nodeId);
    if (awaiting === newContent) {
        console.log('[FloatingWindowManager] Ignoring our own save for node:', nodeId);
        this.awaitingUISavedContent.delete(nodeId);
        continue; // Skip updating the editor
    }
    // ... rest of update logic
}
```

## Regression Test

The test file `editor-feedback-loop-bug.spec.ts` contains two tests:

### Test 1: Basic Feedback Loop Scenario
Simulates the exact bug scenario:
- Types "Hello world"
- Waits for debounce (300ms)
- Types " and more text"
- Waits for filesystem feedback
- **Asserts editor still has full content** ✅

### Test 2: Rapid Edits Race Condition
Simulates rapid typing with multiple saves:
- Types "Line 1", "Line 2", "Line 3" rapidly
- Waits for debounce
- Types "Line 4" after debounce
- **Asserts all lines are preserved** ✅

Both tests use a mock that simulates filesystem feedback with realistic timing (100ms delay for filesystem I/O).

## How to Run Tests

```bash
# Run just the feedback loop tests
npx playwright test e2e-tests/playwright-browser/markdown-editors/editor-feedback-loop-bug.spec.ts

# Run all editor tests
npx playwright test e2e-tests/playwright-browser/markdown-editors/
```

## If Tests Fail

If these tests start failing, the feedback loop bug has been reintroduced. Check:

1. Is `awaitingUISavedContent` still being used in `FloatingWindowManager`?
2. Is content being tracked before calling `modifyNodeContentFromUI()`?
3. Is the comparison `awaiting === newContent` working correctly?
4. Was the map cleanup logic removed accidentally?

## Related Files

- `/src/views/FloatingWindowManager.ts` - Main fix location
- `/src/graph-core/extensions/cytoscape-floating-windows.ts` - Editor creation with tracking
- `/src/floating-windows/CodeMirrorEditorView.ts` - Editor implementation
- `/src/functional_graph/shell/UI/handleUIActions.ts` - modifyNodeContentFromUI function

## Design Notes

This fix follows the principle of **"track UI-initiated changes"** to distinguish them from external changes:

- ✅ **UI → Filesystem → UI feedback**: Ignore (our own change)
- ✅ **External → Filesystem → UI**: Apply (someone else's change)

This is a common pattern for bidirectional sync systems and prevents oscillation.
