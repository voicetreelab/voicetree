# Subtask: Implement Cytoscape Floating Window Extension (Phase 1)

**Agent Name:** FloatingWindowImpl
**Color:** cyan

## Original Specification

From `floatingWindowSpec.md`:

```
We want to start simple, any floating window ALWAYS is attached to a node.

I.e. any floatingWindow, can be added to cytoscape with one command. e.g. .addFloatingWindow()

- moves perfectly with that node position updates.
- zooms with graph, staying fixed in graph space.
- any other graph interactions (pans, etc.) also make the floatingWindow move so it's fixed in graph
  space
- can have edges to other nodes in the graph

under the hood this can be supported with a cytoscape node that it has a two way anchor to.
```

## Current Situation - IMPORTANT

⚠️ **The test file has INCORRECT inline implementation code.** The test currently has the extension code duplicated inline instead of testing actual implementation files. This defeats the purpose of TDD.

**Your job:** Create the REAL implementation files that the test should be testing, then fix the test to import and use those real files.

## Your Component

**What:** A Cytoscape extension module + CSS styling + integration into the application

**Input:** Cytoscape instance + FloatingWindowConfig
```typescript
interface FloatingWindowConfig {
  id: string;
  component: React.ReactElement | string;
  position?: { x: number; y: number };
  nodeData?: any;
}
```

**Output:** Shadow node (cytoscape.NodeSingular) with attached DOM floating window

**Side Effects:**
- Creates DOM overlay container (as sibling to cy container)
- Adds shadow node to graph
- Mounts React components to DOM
- Listens to graph events (pan, zoom, position)

## System Architecture

```
┌─────────────────────────────────────────┐
│  voice-tree-graph-viz-layout.tsx        │
│  (registers extension on init)          │
└─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│  graph-core/index.ts                    │
│  (exports registerFloatingWindows)      │
└─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│  graph-core/extensions/                 │
│  cytoscape-floating-windows.ts          │
│  (core extension logic)                 │
└─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│  graph-core/styles/                     │
│  floating-windows.css                   │
│  (overlay + window styling)             │
└─────────────────────────────────────────┘
```

## Files to Create

1. **`src/graph-core/extensions/cytoscape-floating-windows.ts`**
   - Export `registerFloatingWindows(cytoscape)` function
   - Adds `cy.addFloatingWindow(config)` method
   - Implements shadow node creation, overlay management, transform sync

2. **`src/graph-core/styles/floating-windows.css`**
   - `.cy-floating-overlay` - positioned above graph, pointer-events: none
   - `.cy-floating-window` - window element styling, pointer-events: auto
   - `.floating-window-node` - invisible shadow node (opacity: 0)

3. **Modify `src/graph-core/index.ts`**
   - Export `registerFloatingWindows` function

4. **Modify `src/components/voice-tree-graph-viz-layout.tsx`**
   - Import and call `registerFloatingWindows(cytoscape)` during graph init

## Critical Implementation Details (from plan)

### 1. Overlay Placement ⚠️ CRITICAL
```typescript
// ✅ CORRECT: Append to container's parent
const container = cy.container();
const parent = container.parentElement;
parent.appendChild(overlay);

// ❌ WRONG: Would cause double transform
container.appendChild(overlay);
```

### 2. Transform Synchronization
```typescript
function syncOverlayTransform(cy: Core, overlay: HTMLElement) {
  const pan = cy.pan();
  const zoom = cy.zoom();
  overlay.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
  overlay.style.transformOrigin = 'top left';
}

cy.on('pan zoom resize', () => syncOverlayTransform(cy, overlay));
```

### 3. Position Synchronization (Node → DOM)
```typescript
function updateWindowPosition(node: NodeSingular, domElement: HTMLElement) {
  const pos = node.position();
  domElement.style.left = `${pos.x}px`;
  domElement.style.top = `${pos.y}px`;
  domElement.style.transform = 'translate(-50%, -50%)';
}

cy.on(`position`, 'node', (evt) => {
  // Update window for this node
});
```

### 4. Shadow Node Styling
```typescript
node.style({
  'opacity': 0,
  'events': 'yes',
  'width': 1,
  'height': 1
});
```

### 5. React Component Mounting
```typescript
const reactRoots = new Map<string, ReactDOM.Root>();

function mountComponent(domElement: HTMLElement, component: React.ReactElement | string) {
  if (typeof component === 'string') {
    domElement.innerHTML = component;
  } else {
    const root = ReactDOM.createRoot(domElement);
    root.render(component);
    reactRoots.set(domElement.id, root);
  }
}
```

### 6. Multiple Overlay Prevention
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

## Requirements

- [ ] Create `cytoscape-floating-windows.ts` with `registerFloatingWindows()` and `addFloatingWindow()`
- [ ] Create `floating-windows.css` with proper overlay and shadow node styling
- [ ] Export extension from `graph-core/index.ts`
- [ ] Register extension in `voice-tree-graph-viz-layout.tsx` during init
- [ ] Fix test to import and test ACTUAL implementation (not inline code)
- [ ] All test assertions pass in `floating-window-extension.spec.ts`

## What NOT to Do

- ❌ Do NOT implement Phase 2 features (user dragging, resizing, cleanup/unmounting)
- ❌ Do NOT add title bars, close buttons, or window chrome
- ❌ Do NOT append overlay as child of cy container (must be sibling!)
- ❌ Do NOT leave inline implementation code in test file
- ❌ Do NOT create multiple overlay containers

## Test File

**Current:** `tests/e2e/isolated-with-harness/graph-core/floating-window-extension.spec.ts`

**Issue:** Test has inline extension implementation instead of importing real files

**Fix Required:**
1. Build actual implementation files first
2. Update test to import from actual files (either by bundling or loading script)
3. Ensure test validates behavior against real implementation

## Success Criteria

- [ ] Extension files exist and export correct functions
- [ ] CSS properly styles overlay (invisible shadow nodes, visible windows)
- [ ] Integration complete (exported and registered)
- [ ] Test imports and validates REAL implementation
- [ ] All test assertions pass:
  - Extension registration ✓
  - Shadow node creation ✓
  - DOM overlay creation and reuse ✓
  - React component rendering ✓
  - Pan synchronization ✓
  - Zoom synchronization ✓
  - Node position tracking ✓
  - Edge connectivity ✓
  - Multiple windows on shared overlay ✓

## Run Test

```bash
npx playwright test tests/e2e/isolated-with-harness/graph-core/floating-window-extension.spec.ts
```

Test should FAIL initially (red phase), then PASS after implementation (green phase).
