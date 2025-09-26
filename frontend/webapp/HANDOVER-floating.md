### Handover Document: Floating Markdown Editor Feature

**1. Overall Goal, Problems, and System Desired**

*   **Goal:** To implement floating, draggable Markdown editors that are dynamically attached to nodes within the Cytoscape graph, allowing users to view and edit file content directly.
*   **Problems Addressed:** Lack of direct in-graph editing, need for file saving, integration with Cytoscape.
*   **System Desired:** A modular and extensible system for floating UI elements (editors, terminals) that synchronize their position and state with graph nodes, providing a rich interactive experience.

**2. Architecture Designed (ASCII Tree)**

```
VoiceTree Webapp
|
+-- Electron Backend
|   |
|   +-- electron.js
|   |   |
|   |   +-- IPC Handler: 'save-file-content'
|   |       |  [No dedicated test]
|   |       |  Core Function: Receives a file path and content string, and writes the content to the filesystem.
|   |
|   +-- preload.js
|       |
|       +-- electronAPI.saveFileContent
|           |  [No dedicated test]
|           |  Core Function: Exposes the 'save-file-content' IPC channel to the frontend.
|
+-- Frontend Application (React)
    |
    +-- Hooks
    |   |
    |   +-- useGraphManager.tsx
    |       |  [tests/unit/hooks/useGraphManager.test.tsx] (Existing)
    |       |  Core Function: Takes file system events and provides graph data and a map of file contents to the application.
    |
    +-- App.tsx
    |   |  [No dedicated test]
    |   |  Core Function: Takes application state and renders the main UI, now wrapping the layout in the FloatingWindowManagerProvider.
    |
    +-- Components
        |
        +-- voicetree-layout.tsx
        |   |  [No dedicated test for the new logic]
        |   |  Core Function: Takes graph data and file contents, renders the Cytoscape graph, and calls the 'openWindow' function on node clicks.
        |
        +-- floating-windows/ (New Module)
            |
            +-- context/FloatingWindowManager.tsx
            |   |  [No dedicated test]
            |   |  Core Function: Takes window actions (e.g., open, close) and provides an array of window state objects to the UI.
            |
            +-- FloatingWindowContainer.tsx
            |   |  [No dedicated test]
            |   |  Core Function: Takes an array of window state objects and renders a <FloatingWindow> component for each one.
            |
            +-- FloatingWindow.tsx
            |   |  [No dedicated test]
            |   |  Core Function: Takes a single window state object and renders a draggable window frame containing the appropriate editor.
            |
            +-- editors/MarkdownEditor.tsx
            |   |  [No dedicated test]
            |   |  Core Function: Takes initial markdown content and a file path, and provides a rich text editor UI that can trigger a save action.
            |
            +-- editors/MermaidRenderer.tsx
                |  [No dedicated test]
                |  Core Function: Takes a string of Mermaid diagram syntax and renders it as an SVG image.

```

**3. Current State**

*   **Feature Implementation:** The floating Markdown editor feature, including its UI components, state management, and Electron-based file saving, is fully implemented and committed.
*   **Test Status:**
    *   **Unit Tests (Vitest):** All existing unit tests are passing.
    *   **E2E Tests (Playwright):**
        *   Existing E2E tests are largely failing (18 out of 66 tests failed in the last full run).
        *   The newly created standalone E2E test for the floating editor (`tests/e2e/floating-editor.spec.ts`) is also failing.

**4. Problems, Hunches, and Immediate Next Steps**

*   **Problem 1: Standalone Floating Editor Test Failure:** The new standalone test for the floating editor (`floating-editor.spec.ts`) fails to find the `.floating-window` element. This indicates the floating window components are not rendering correctly within the test harness.
    *   **Hunch:** There's a subtle issue with the `FloatingWindowManagerProvider` or `FloatingWindowContainer` preventing the window from being rendered or becoming visible in the Playwright environment.
    *   **Immediate Next Step:** Analyze the results of the currently running diagnostic test (which checks for a static `<h1>` tag). This will determine if the React app is mounting at all, or if the issue is specific to the floating window components.

*   **Problem 2: Existing E2E Test Failures (Graph Updates):** Many existing E2E tests are failing because the Cytoscape graph is not updating after mock file events are dispatched.
    *   **Hunch:** While the `MockElectronAPI` is set up to listen for `CustomEvent`s and emit internal events, there might be a timing issue or a break in the data flow from these mock events through the `useGraphManager` hook to the graph rendering logic in `voicetree-layout.tsx`.
    *   **Immediate Next Step:** Once the standalone editor test is stable, revisit the `useGraphManager` data flow and event handling within the E2E test environment.

**5. Tech Debt / Complexity / Struggles**

*   **Largest Tech Debt / Complexity:** The most significant complexity lies in the interaction between the React component lifecycle, the Context API for state management, and the Cytoscape.js canvas. Ensuring seamless synchronization of DOM-based floating elements with a canvas-rendered graph, especially during pan, zoom, and drag operations, is inherently challenging. The mocking of the Electron API for browser-based E2E tests also adds a layer of intricate setup.
*   **Struggled Most With:** My primary struggle has been with debugging the Playwright E2E test environment. The `claude` sub-agent interaction issues, followed by a `require is not defined` error (which proved to be an environment-specific bug in Playwright's handling of certain code patterns), and now the rendering issues in the standalone test, highlight a significant challenge in understanding and controlling the test execution context. The lack of direct visual feedback (e.g., interactive debugging or immediate screenshot viewing) within this tool environment has made diagnosing these subtle test setup and rendering issues particularly difficult and time-consuming.