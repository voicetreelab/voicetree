# Subtask: Integrate Real MarkdownEditor Component with Floating Windows

**Agent Name:** EditorIntegrator
**Color:** orange

## PRIMARY OBJECTIVE

Make the actual MarkdownEditor component (`src/components/floating-windows/editors/MarkdownEditor.tsx`) work inside floating windows with full interactivity.

**This is THE most important test** - simple test components don't validate real-world complexity.

## Spec Requirement (CRITICAL)

From `floatingWindowSpec.md`:

```
## PRIMARY REQUIREMENT: Real MarkdownEditor Integration

The floating window system MUST work with the actual MarkdownEditor component.

Required Editor Functionality:
- User can type and edit markdown content
- Save button is clickable and functional
- All pointer events (click, select text, drag selection) work correctly
- No conflicts with graph interactions (pan/zoom don't interfere with editor)
- MDEditor component renders and functions normally
```

## Current Situation

Phase 1 floating windows work with simple React test components, but the **real MarkdownEditor** has:
- Complex MDEditor component (@uiw/react-md-editor)
- `useFloatingWindows` hook dependency
- Interactive textarea and buttons
- State management
- Debounced updates

## Your Component

**What:** MarkdownEditor integration into floating window extension

**Input:** `cy.addFloatingWindow({ component: 'MarkdownEditor', ... })`

**Output:** Fully functional MarkdownEditor in floating window

**Critical Functionality:**
1. Editor renders with MDEditor component
2. User can type/edit markdown
3. Save button clicks work
4. Text selection works (no graph pan interference)
5. Works after pan/zoom transformations

## System Architecture

```
┌─────────────────────────────────────────┐
│  MarkdownEditor Component               │
│  (uses MDEditor, has complex UI)        │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│  Floating Window Extension              │
│  (must render MarkdownEditor properly)  │
└─────────────────────────────────────────┐
                    ↓
┌─────────────────────────────────────────┐
│  Cytoscape Graph                        │
│  (pan/zoom must not interfere)          │
└─────────────────────────────────────────┘
```

## Key Challenges to Solve

### 1. Component Loading
The extension needs to load and render the actual MarkdownEditor component, not just string HTML.

**Options:**
- Bundle MarkdownEditor with extension
- Dynamic import in test harness
- Provide MarkdownEditor factory to extension

### 2. useFloatingWindows Hook
MarkdownEditor uses `useFloatingWindows()` hook which needs a provider.

**Solution:** Provide mock or minimal implementation:
```typescript
const FloatingWindowsProvider = ({ children }) => {
  const updateWindowContent = (id: string, content: string) => {
    // Store in window data or emit event
  };
  return <FloatingWindowsContext.Provider value={{ updateWindowContent }}>
    {children}
  </FloatingWindowsContext.Provider>;
};
```

### 3. Pointer Events
**CRITICAL:** Editor needs `pointer-events: auto` but overlay has `pointer-events: none`.

Current setup should work, but verify:
- `.cy-floating-overlay`: `pointer-events: none`
- `.cy-floating-window`: `pointer-events: auto`
- Text selection doesn't trigger graph pan

### 4. Event Isolation
Clicking/dragging in editor must NOT:
- Pan the graph
- Select nodes
- Trigger box selection

**Solution:** Stop propagation on window element:
```javascript
windowElement.addEventListener('mousedown', (e) => e.stopPropagation());
windowElement.addEventListener('wheel', (e) => e.stopPropagation());
```

## Files to Modify

1. **`src/graph-core/extensions/cytoscape-floating-windows.ts`**
   - Add support for rendering real MarkdownEditor
   - Handle component: 'MarkdownEditor' config
   - Provide FloatingWindows context provider
   - Add event isolation for pointer events

2. **`tests/e2e/isolated-with-harness/graph-core/floating-window-markdown-editor.spec.ts`** (already created)
   - May need to inject MarkdownEditor component definition
   - Or import from bundled test file

3. **Possibly create:** `tests/e2e/isolated-with-harness/graph-core/markdown-editor-test-bundle.tsx`
   - Bundle MarkdownEditor with minimal dependencies for testing

## Requirements

- [ ] MarkdownEditor renders in floating window
- [ ] User can type in textarea
- [ ] Save button is clickable
- [ ] Text selection works without graph pan
- [ ] Editor works after pan/zoom
- [ ] No console errors
- [ ] All tests in `floating-window-markdown-editor.spec.ts` pass

## What NOT to Do

- ❌ Don't create a simplified/fake MarkdownEditor - use the REAL one
- ❌ Don't skip useFloatingWindows hook - provide proper mock/context
- ❌ Don't allow editor interactions to interfere with graph
- ❌ Don't modify the MarkdownEditor component itself

## Critical Implementation Details

### Event Isolation Pattern
```typescript
// In addFloatingWindow function
windowElement.addEventListener('mousedown', (e) => {
  e.stopPropagation(); // Prevent graph pan
});

windowElement.addEventListener('wheel', (e) => {
  e.stopPropagation(); // Prevent graph zoom
}, { passive: false });
```

### MarkdownEditor Context Provider
```typescript
// Minimal mock for testing
const mockFloatingWindowsContext = {
  updateWindowContent: (id: string, content: string) => {
    console.log(`Window ${id} content updated:`, content);
  }
};
```

### Component Rendering Approach
```typescript
if (config.component === 'MarkdownEditor') {
  // Render with context provider
  const root = ReactDOM.createRoot(windowElement);
  root.render(
    <FloatingWindowsProvider>
      <MarkdownEditor
        windowId={config.id}
        content={config.initialContent || ''}
        onSave={(content) => console.log('Saved:', content)}
      />
    </FloatingWindowsProvider>
  );
}
```

## Test File

**Run:** `npx playwright test tests/e2e/isolated-with-harness/graph-core/floating-window-markdown-editor.spec.ts`

**Expected:** All tests pass
- ✅ MarkdownEditor renders
- ✅ Can type in editor
- ✅ Save button clickable
- ✅ Text selection works
- ✅ No graph interference

## Success Criteria

- [ ] Test passes: Editor renders with MDEditor
- [ ] Test passes: User can type markdown
- [ ] Test passes: Save button functional
- [ ] Test passes: Text selection doesn't pan graph
- [ ] Test passes: Editor works after pan/zoom
- [ ] No console errors during interaction
- [ ] Screenshot shows functional editor

## TDD Approach

1. **Run test** - confirm it fails (MarkdownEditor not rendering)
2. **Implement** - Add MarkdownEditor rendering to extension
3. **Run test** - confirm specific failures (e.g., context missing)
4. **Fix** - Add context provider
5. **Run test** - confirm next failure (e.g., pointer events)
6. **Fix** - Add event isolation
7. **Run test** - All pass ✅

Report back: implementation approach, issues encountered, final test results.
