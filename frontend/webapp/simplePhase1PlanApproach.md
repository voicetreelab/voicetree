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
