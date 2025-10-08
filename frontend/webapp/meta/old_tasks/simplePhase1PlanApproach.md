# Simple Phase 1 Plan: Graph-First Floating Windows

This plan outlines the foundational steps to implement floating windows that are directly tied to Cytoscape nodes. Phase 1 focuses on displaying windows and ensuring they are perfectly synchronized with graph pan/zoom movements. User interaction (dragging, resizing) will be handled in Phase 2.

### Step 1: Create the Cytoscape Extension Core

This step introduces the main logic as a self-contained Cytoscape extension.

*   **File to Create:** `src/graph-core/extensions/cytoscape-floating-windows.ts`
*   **High-Level Code Changes:**
    *   Implement a `registerFloatingWindows(cytoscape)` function that adds a new method, `cy.addFloatingWindow(config)`.
    *   The `addFloatingWindow` method will:
        1.  Create an invisible "shadow" node in Cytoscape to represent the window's position and allow for edge connections.
        2.  Create a single, shared DOM overlay container that will hold all floating windows.
        3.  Listen to graph `pan` and `zoom` events to apply a CSS `transform` to the overlay, keeping all windows in sync with the graph's viewport.
        4.  For each window, create a DOM element and use `ReactDOM.createRoot()` to render the specified React component into it.
        5.  Listen to the shadow node's `position` event to update the DOM element's position within the overlay.
*   **Behavior to Test (Unit Tests):**
    *   Verify that `cy.addFloatingWindow()` adds one node to `cy.nodes()`.
    *   Verify that a corresponding DOM element is created and mounted with the React component.
    *   Verify that the window's position remains fixed relative to other graph elements during pan and zoom operations.
    *   Verify that programmatically changing the shadow node's position correctly updates the DOM window's visual position.

### Step 2: Add Essential Styling

This step ensures the windows are visible and the underlying shadow nodes are not.

*   **File to Create:** `src/graph-core/styles/floating-windows.css`
*   **High-Level Code Changes:**
    *   Add CSS for the `.cy-floating-overlay` to position it correctly above the graph canvas.
    *   Add CSS for `.cy-floating-window` to define default window appearance (e.g., `position: absolute`, background, border).
    *   Add CSS for the `.floating-window-node` class to make the shadow node invisible on the canvas (`opacity: 0`).
*   **Behavior to Test (E2E/Visual Tests):**
    *   Confirm the floating window appears with the correct styling.
    *   Confirm the backing Cytoscape node is not visible on the canvas.
    *   Confirm the window appears above graph edges and nodes.

### Step 3: Register and Integrate the Extension

This step wires up the new extension so it can be used by the application.

*   **Files to Modify:**
    *   `src/components/voice-tree-graph-viz-layout.tsx`:
        *   Import `registerFloatingWindows`.
        *   Call `registerFloatingWindows(cytoscape)` once during the graph initialization sequence.
    *   `src/graph-core/index.ts`:
        *   Export the `registerFloatingWindows` function.
*   **Behavior to Test (Integration Tests):**
    *   Confirm the `cy.addFloatingWindow` function is available on the main application's Cytoscape instance.
    *   Confirm that adding a window through the main application graph works as expected and does not cause crashes.

---

## Critical Implementation Details

### TypeScript Interfaces

```typescript
// In cytoscape-floating-windows.ts
interface FloatingWindowConfig {
  id: string;
  component: React.ReactElement | string;  // React component or HTML string
  position?: { x: number; y: number };     // Optional initial position
  nodeData?: any;                          // Additional data for the shadow node
}

// Extend Cytoscape Core type
declare module 'cytoscape' {
  interface Core {
    addFloatingWindow(config: FloatingWindowConfig): cytoscape.NodeSingular;
  }
}
```

### Overlay Placement (CRITICAL)

**DO NOT** append overlay as child of cytoscape container. Instead:

```typescript
// ✅ CORRECT: Append to container's parent
const container = cy.container();
const parent = container.parentElement;
parent.appendChild(overlay);

// ❌ WRONG: Would cause double transform
container.appendChild(overlay);
```

**Why:** Cytoscape container itself may have transforms. Overlay must be a sibling to avoid compounding transforms.

### Transform Synchronization Formula

```typescript
function syncOverlayTransform(cy: Core, overlay: HTMLElement) {
  const pan = cy.pan();
  const zoom = cy.zoom();

  // GPU-accelerated transform - affects all windows at once
  overlay.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
  overlay.style.transformOrigin = 'top left';
}

// Listen to ALL viewport changes
cy.on('pan zoom resize', () => syncOverlayTransform(cy, overlay));
```

### Position Synchronization (Node → DOM)

```typescript
function updateWindowPosition(node: NodeSingular, domElement: HTMLElement) {
  const pos = node.position();

  // Position element at node's graph coordinates
  domElement.style.left = `${pos.x}px`;
  domElement.style.top = `${pos.y}px`;

  // Center element on position point
  domElement.style.transform = 'translate(-50%, -50%)';
}

// Listen to specific node's position changes
cy.on(`position.${nodeId}`, () => updateWindowPosition(node, element));
```

### Shadow Node Styling

```typescript
// Make node invisible but interactive
node.style({
  'opacity': 0,           // Invisible on canvas
  'events': 'yes',        // Still receives events (for edges, selection, layout)
  'width': 1,             // Minimal size to not interfere with layout
  'height': 1
});

node.addClass('floating-window-node');
```

### React Component Mounting

```typescript
// Store roots for later cleanup (Phase 2)
const reactRoots = new Map<string, ReactDOM.Root>();

function mountComponent(domElement: HTMLElement, component: React.ReactElement | string) {
  if (typeof component === 'string') {
    // HTML string
    domElement.innerHTML = component;
  } else {
    // React component
    const root = ReactDOM.createRoot(domElement);
    root.render(component);
    reactRoots.set(domElement.id, root);
  }
}
```

---

## Edge Cases & Gotchas

1. **Multiple overlay creation:** Ensure `getOrCreateOverlay()` returns existing overlay if present:
   ```typescript
   function getOrCreateOverlay(cy: Core): HTMLElement {
     const container = cy.container();
     const parent = container.parentElement;
     let overlay = parent.querySelector('.cy-floating-overlay') as HTMLElement;

     if (!overlay) {
       overlay = document.createElement('div');
       overlay.className = 'cy-floating-overlay';
       // ... setup
       parent.appendChild(overlay);
     }

     return overlay;
   }
   ```

2. **Transform origin matters:** Must be `top left` to match Cytoscape's coordinate system origin.

3. **Pointer events layering:**
   - Overlay: `pointer-events: none` (let graph handle events)
   - Window elements: `pointer-events: auto` (re-enable for windows)

4. **Z-index hierarchy:**
   ```css
   #cy { position: relative; z-index: 1; }
   .cy-floating-overlay { z-index: 10; }
   .cy-floating-window { z-index: 1; }  /* relative within overlay */
   ```

5. **Event namespacing:** Use namespaced events to allow removal:
   ```typescript
   cy.on(`position.window-${nodeId}`, handler);
   // Later: cy.off(`position.window-${nodeId}`);
   ```

---

## What Phase 1 Does NOT Include

Phase 1 is **display only**. Explicitly excluded:

- ❌ User dragging windows (DOM → Node sync)
- ❌ Window resizing
- ❌ Memory cleanup / React root unmounting
- ❌ ResizeObserver for size sync
- ❌ Event conflict resolution (box selection, etc.)
- ❌ Migration of existing FloatingWindow system
- ❌ Title bars, close buttons, or window chrome

Phase 1 Success = Windows appear and move perfectly with graph transformations.

---

## Test Coverage

**Created Test File:** `tests/e2e/isolated-with-harness/graph-core/floating-window-extension.spec.ts`

This test validates:
1. Extension registration
2. Shadow node creation
3. DOM overlay creation and reuse
4. React component rendering
5. Pan synchronization (transform updates, position unchanged)
6. Zoom synchronization (scale updates)
7. Node position tracking (move node → window follows)
8. Edge connectivity (shadow node accepts edges)
9. Multiple windows (shared overlay)

**Run test:**
```bash
npx playwright test tests/e2e/isolated-with-harness/graph-core/floating-window-extension.spec.ts
```

Test will **fail** until implementation is complete.

---

## Implementation Order

1. Create `cytoscape-floating-windows.ts` with extension registration
2. Create `floating-windows.css` with styles
3. Update `graph-core/index.ts` to export extension
4. Update `voice-tree-graph-viz-layout.tsx` to register extension
5. Run test to verify all behaviors pass
6. Manual testing with real markdown editor component

**Estimated time:** 2-3 hours for Phase 1 implementation.
