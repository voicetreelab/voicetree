# Floating Window Refactor Plan

This document outlines the plan to refactor the floating window system to resolve testing race conditions while maintaining high performance.

## 1. Overall Solution

The solution is to separate the floating window's structural frame (the "chrome") from its interactive content. The frame will be created instantly and synchronously with standard JavaScript, which fixes the testing race condition. The complex content (like the Markdown Editor) will then be loaded into the frame asynchronously by React.

This approach provides an immediate, testable DOM element for our test suites while preserving the existing, high-performance pan/zoom logic that relies on direct DOM manipulation.

## 2. High-Level Architecture

The architecture separates responsibilities cleanly between vanilla DOM for the structure and React for the content.

1.  **Cytoscape Graph:** Contains an invisible **"Shadow Node"** that acts as the logical anchor for a window's position in graph space.
2.  **Overlay `div`:** A single container whose `transform` style is updated on pan/zoom events (this logic remains unchanged).
3.  **Window "Chrome" (Vanilla JS/DOM):**
    *   Created **synchronously** by the extension when a window is added.
    *   Contains the main window `div`, a `titleBar`, and a `contentContainer`.
    *   Drag-and-drop logic is attached directly to the `titleBar`.
4.  **Window "Content" (React):**
    *   A React component (e.g., `MarkdownEditor`) is rendered **asynchronously** into the `contentContainer`. This creates an isolated React "island" for the window's content.

```
+---------------------------------------------------+
| Cytoscape Overlay (moves with pan/zoom)           |
|                                                   |
|   +-------------------------------------------+   |
|   | Window "Chrome" (Vanilla DOM)             |   |
|   | +---------------------------------------+ |   |
|   | | Title Bar (drag handles)              | |   |
|   | +---------------------------------------+ |   |
|   | | Content Container                     | |   |
|   | | +-----------------------------------+ | |   |
|   | | | React Component (MarkdownEditor)  | | |   |
|   | | | (Renders asynchronously)          | | |   |
|   | | +-----------------------------------+ | |   |
|   | +-------------------------------------------+   |
|   |                                           |   |
+---------------------------------------------------+
```

## 3. Code Flow

The execution flow for creating a new window will be as follows:

1.  **Trigger:** A test or user action calls `cy.addFloatingWindow(...)`.
2.  **Synchronous Creation (The Fix):**
    *   The extension creates the invisible Cytoscape **shadow node**.
    *   Using `document.createElement`, it **immediately** builds the entire window frame: the main `div`, the `titleBar`, and the `contentContainer`.
    *   It attaches drag-and-drop event listeners directly to the `titleBar` element.
    *   The fully formed (but content-empty) window frame is appended to the DOM.
    *   The function returns. At this point, tests can reliably find elements like `.cy-floating-window-title` because they exist in the DOM.
3.  **Asynchronous Rendering:**
    *   After appending the frame, the extension makes a non-blocking call to `ReactDOM.createRoot(contentContainer).render(...)`.
    *   React takes over and renders the specified component (e.g., `MarkdownEditor`) inside the `contentContainer` when it's ready. This does not block the main thread or the test.
4.  **Pan/Zoom Operation:**
    *   This flow remains unchanged. The existing `cy.on('pan zoom', ...)` listener will continue to efficiently update the CSS `transform` of the main overlay, moving all windows smoothly.

## 4. Primary File Changes

The refactoring will be concentrated in the following files:

*   **`src/graph-core/extensions/cytoscape-floating-windows.ts`**: This is where the core logic will be refactored. We will implement the synchronous DOM creation for the window chrome and handle the asynchronous mounting of the React content.
*   **`src/components/floating-windows/WindowWrapper.tsx` (or similar)**: This React component will likely be removed or significantly simplified, as its responsibilities (dragging, title bar rendering) will be moved into the vanilla JavaScript logic within the Cytoscape extension.

## 5. Rejected Alternatives

We explicitly considered and rejected the following approaches to ensure we chose the most optimal solution.

1.  **The "Bridge" Architecture (React State for Pan/Zoom):**
    *   **Description:** This approach involved creating a central React state manager for all windows. The Cytoscape extension would call a "bridge" function (`window.appApi.addWindow`) to update the React state. Pan/zoom events would also update React state, causing the entire window container to re-render.
    *   **Reason for Rejection:** This would have caused a **major performance regression**. Handling high-frequency events like pan/zoom with React's `setState` introduces significant overhead and would make graph navigation feel sluggish. It also over-engineered the solution for a simple initial-render race condition.

2.  **Forcing a Synchronous Render with `flushSync`:**
    *   **Description:** This involved wrapping the `root.render()` call in React 18's `flushSync()` function to force the DOM to be updated immediately.
    *   **Reason for Rejection:** While this would have fixed the race condition with minimal code changes, the "Vanilla DOM Chrome" approach is architecturally cleaner. It correctly separates the static structural elements from the dynamic React content and avoids relying on a React-specific escape hatch, resulting in a more robust and maintainable design.
