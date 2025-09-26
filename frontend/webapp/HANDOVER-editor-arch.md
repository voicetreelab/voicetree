# Floating Editor Architecture Handover

## 1. Goal & Problem

**Goal:** Allow users to click on a graph node and edit its underlying Markdown content in a floating window.

**Problem:** A recent, successful performance refactoring moved the graph's state management out of React and into a direct Cytoscape.js instance. This broke the connection between the graph visualization and the floating editor components. The editors no longer have a way to read the initial content of a node or save their changes back to the file system, which is the application's single source of truth.

We need to re-establish this data flow in a way that is robust, maintainable, and testable.

## 2. Constraints

Any proposed solution must satisfy the following constraints:

1.  **Testability:** The editor component must be testable in isolation, without requiring a full Electron environment. This includes unit tests and component harness tests (e.g., Storybook, Playwright component testing).
2.  **Decoupling:** The editor component must not be tightly coupled to the Electron API or the file system. It should be a "pure" UI component.
3.  **Browser Compatibility:** The application must remain runnable in a standard web browser for development and testing purposes, even if file-saving functionality is limited.
4.  **Single Source of Truth:** The file system must remain the single source of truth for all content. The graph and editors are reflections of the state of the files on disk.

## 3. Alternatives Disregarded

### Alternative 1: Direct File System Access from Editor

-   **Description:** In this model, the editor component itself would be responsible for interacting with the file system. When opened, it would receive a `filePath` prop and use `window.electronAPI.readFile(filePath)` to load its initial content. To save, it would call `window.electronAPI.saveFileContent(...)`.
-   **Data Flow:** `Editor <-> File System`
-   **Reason for Rejection:** This approach was rejected because it violates our core constraints:
    -   **Breaks Testability:** The editor could not be tested without mocking the entire `window.electronAPI`, making simple component tests complex and brittle.
    -   **Breaks Browser Compatibility:** The editor would crash if opened in a browser where the Electron API is not present.
    -   **Creates Tight Coupling:** The editor becomes permanently dependent on the Electron environment, making it impossible to reuse or develop in isolation.

## 4. Proposed Solution

The chosen architecture uses the principle of **Inversion of Control**. The editor component will be a "pure" or "dumb" component that is orchestrated by its parent (`VoiceTreeLayout`). It receives its content and the functions it needs to communicate changes as props.

This creates a clean, unidirectional data flow loop.

### Data Flow Diagram

The architecture is broken into three distinct phases:

**1. Read Path (Opening the Editor):**
`VoiceTreeLayout (reads from in-memory cache) -> Editor (receives 'content' and 'onSave' props)`

**2. Write Path (Saving from the Editor):**
`Editor (user saves) -> onSave(newContent) callback executes in VoiceTreeLayout -> File System is updated via Electron API`

**3. Reactive Update Path (Graph Visualization):**
`File System change detected by Watcher -> VoiceTreeLayout updates its cache -> VoiceTreeLayout updates Cytoscape graph`

This model ensures the editor remains completely decoupled. It has no knowledge of where the data comes from or where it goes, making it perfectly testable and fulfilling all our constraints.

## 5. Implementation Plan

1.  **Modify Floating Window Props:**
    -   Update the `MarkdownEditor` component and the floating window container to accept an `onSave: (newContent: string) => void` callback function as a prop.
    -   The editor will no longer receive a `filePath`. It will only receive the initial `content` and the `onSave` callback.

2.  **Implement `onSave` Logic in the Editor:**
    -   Inside the `MarkdownEditor`, when the user triggers a save action, call the `onSave` prop with the editor's current content.

3.  **Update `VoiceTreeLayout`:**
    -   When a node is clicked, retrieve the `filePath` and the latest content from the `markdownFiles.current` cache.
    -   When calling `openWindow` for the editor, pass:
        -   The retrieved `content`.
        -   An `onSave` callback function. This function will take the `newContent` from the editor and call `window.electronAPI.saveFileContent(filePath, newContent)`.

4.  **Verify the Loop:**
    -   Confirm that saving from the editor writes the content to the file.
    -   Confirm that the file watcher detects the change.
    -   Confirm that `VoiceTreeLayout` receives the file change event and updates the Cytoscape graph node accordingly (e.g., updating a label or style).

5.  **Update Tests:**
    -   Update existing component tests for the editor to pass a mock `onSave` function and assert that it is called correctly.
    -   Ensure E2E tests that involve editing and saving still pass.

## 6. Synchronizing UI with Graph Viewport

A significant challenge in this architecture is ensuring that floating UI components (like the editors) remain visually attached to their corresponding graph nodes during graph interactions like panning, zooming, and resizing.

### Problem

The Cytoscape canvas is a direct-manipulation DOM element, while the floating windows are React components living in a separate part of the DOM. There is no automatic link between them. When the user pans the graph, the Cytoscape canvas moves, but the React components will remain stationary, appearing disconnected from their nodes.

### Solution: Bridge Cytoscape Events to React State

We will create a communication bridge between the Cytoscape instance and the React component that manages the floating windows (`FloatingWindowContainer`).

**Data Flow for Positioning:**

1.  **Event Listening:** The `VoiceTreeLayout` component, which owns the Cytoscape instance, will listen for viewport change events (`pan`, `zoom`, `resize`).
2.  **Performance Throttling:** To prevent performance issues from the high frequency of these events, the event handler will use `requestAnimationFrame` to ensure that position updates are calculated only once per browser frame.
3.  **Coordinate Translation:** In the animation frame callback, for every open window, we will:
    a. Get the corresponding Cytoscape node by its ID.
    b. Use the `node.renderedPosition()` function to get the node's current `(x, y)` coordinates on the screen.
4.  **State Update via Callback:**
    a. `VoiceTreeLayout` will call a new prop, `onViewportChange`, passing it a map of all open window IDs and their new screen coordinates.
    b. This prop will be provided by `FloatingWindowContainer`, which will update its state with the new positions.
    c. This state update will trigger a re-render in React, and the floating windows will move to their new positions, appearing locked to the graph nodes.

### Implementation Plan Additions

6.  **Create Viewport Callback:**
    -   In `FloatingWindowContainer`, define a state management strategy for window positions and create a callback function (`handleViewportChange`) that updates this state.
7.  **Bridge the Components:**
    -   Pass the `handleViewportChange` function as a prop (`onViewportChange`) to `VoiceTreeLayout`.
8.  **Implement Event Listeners in `VoiceTreeLayout`:**
    -   In the `useEffect` hook where the Cytoscape instance is initialized, attach listeners for the `pan`, `zoom`, and `resize` events.
    -   Implement the throttled position calculation logic inside these listeners and have them call the `onViewportChange` prop.
