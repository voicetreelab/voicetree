# Floating Window Refactoring Plan

## Goal
Split `addFloatingWindow` into separate concerns:
1. **Window creation** - DOM + component mounting (no anchoring)
2. **Node anchoring** - Shadow node creation + bidirectional sync

## Agreed API Design

### Core Types

```typescript
interface FloatingWindow {
  id: string;
  cy: cytoscape.Core;
  windowElement: HTMLElement;
  contentContainer: HTMLElement;
  titleBar: HTMLElement;
  cleanup: () => void;
}
```

### Component-Specific Creator Functions

```typescript
function createFloatingEditor(
  cy: cytoscape.Core,
  config: {
    id: string,
    title: string,
    content: string,
    onSave?: (content: string) => Promise<void>,
    onClose?: () => void,
    resizable?: boolean
  }
): FloatingWindow
```

**Internally:**
1. Creates `CodeMirrorEditorView` instance
2. Creates window chrome (title bar, close button, container)
3. Mounts editor to contentContainer
4. Adds window to overlay
5. Returns FloatingWindow object with cleanup function

```typescript
function createFloatingTerminal(
  cy: cytoscape.Core,
  config: {
    id: string,
    title: string,
    nodeMetadata: NodeMetadata,
    onClose?: () => void,
    resizable?: boolean
  }
): FloatingWindow
```

Similar pattern for terminals.

### Anchoring Function

```typescript
function anchorToNode(
  floatingWindow: FloatingWindow,
  parentNode: NodeSingular,
  shadowNodeData?: Record<string, unknown>
): NodeSingular  // returns shadow node
```

**Deep function that hides complexity:**
1. Creates shadow node at parent's position (layout algorithm handles final positioning)
2. Sets shadow node dimensions from `floatingWindow.windowElement.offsetWidth/Height`
3. Creates edge from parent to shadow node
4. Sets up **ResizeObserver** (window resize → shadow dimensions)
   - Browser detects when window size changes (CSS resize or content)
   - Callback reads new dimensions from DOM
   - Updates shadow node dimensions for layout algorithm
5. Sets up position listener (shadow position → window position)
6. Attaches drag handlers (window drag → shadow position)
7. Returns shadow node

## Usage Patterns

### Anchored Editor (in FloatingWindowManager.createFloatingEditor)

```typescript
const floatingWindow = createFloatingEditor(this.cy, {
  id: editorId,
  title: `Editor: ${nodeId}`,
  content: content,
  onSave: async (newContent) => await modifyNodeContentFromUI(nodeId, newContent),
  onClose: () => this.nodeIdToEditorId.delete(nodeId),
  resizable: true
});

anchorToNode(floatingWindow, cyNode, {
  isFloatingWindow: true,
  isShadowNode: true,
  laidOut: false
});
```

### Unanchored Hover Editor (in FloatingWindowManager.openHoverEditor)

```typescript
const floatingWindow = createFloatingEditor(this.cy, {
  id: hoverId,
  title: `Hover: ${nodeId}`,
  content: content,
  onSave: async (newContent) => await electronAPI.saveFileContent(filePath, newContent)
});

// Manual positioning (no anchor, no shadow node)
floatingWindow.windowElement.style.left = `${nodePos.x + 50}px`;
floatingWindow.windowElement.style.top = `${nodePos.y}px`;
```

## Resize Flow (for anchored windows)

1. **User drags resize handle** → Browser updates DOM dimensions
2. **ResizeObserver fires** (set up in `anchorToNode`)
3. **Callback reads** `windowElement.offsetWidth/Height`
4. **Updates shadow node** `style({width, height})`
5. **Layout algorithm reacts** to new node dimensions

Flow: `DOM resize → ResizeObserver → Shadow node → Layout`

## Key Benefits

1. **Separation of concerns**: Window creation independent of anchoring
2. **Reusability**: Same `createFloatingEditor` for anchored and unanchored windows
3. **No string-based component switching**: Type-safe component creation
4. **Deep, narrow API**: `anchorToNode` hides all synchronization complexity
5. **ResizeObserver only when needed**: Only created for anchored windows

## Migration Steps

1. ✅ Add `FloatingWindow` interface
2. ✅ Refactor `createWindowChrome` to remove shadow node dependencies
3. ⏳ Create `createFloatingEditor` function
4. ⏳ Create `createFloatingTerminal` function
5. ⏳ Create `anchorToNode` function with shadow creation + sync
6. ⏳ Update `FloatingWindowManager.createFloatingEditor` to use new API
7. ⏳ Update `FloatingWindowManager.openHoverEditor` to use new API
8. ⏳ Update `FloatingWindowManager.createFloatingTerminal` to use new API
9. ⏳ Deprecate old `addFloatingWindow` (or keep as convenience wrapper)
10. ⏳ Run tests to verify
