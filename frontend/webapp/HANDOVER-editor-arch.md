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

editor <-> indirection layer <-> filies -> graphData -> graphViiz (slighlty different for read/write paths)


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

## 7. Implementation Progress

### Task Tree

```
┌─────────────────────────────────────────────────────────────┐
│                     PHASE 1: Foundation                      │
│                    (Can be parallelized)                     │
└─────────────────────────────────────────────────────────────┘
                              │
                 ┌────────────┴────────────┐
                 ▼                         ▼
    ┌─────────────────────┐     ┌─────────────────────┐
    │  1.1 Editor Props   │     │  1.2 State Setup    │
    │     Refactoring     │     │  in VoiceTreeLayout │
    ├─────────────────────┤     ├─────────────────────┤
    │ • Remove filePath   │     │ • Add editor state  │
    │ • Add content prop  │     │ • Track open editors│
    │ • Add onSave prop   │     │ • Cache positions   │
    └─────────────────────┘     └─────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                     PHASE 2: Core Logic                      │
│                  (Depends on Phase 1)                        │
└─────────────────────────────────────────────────────────────┘
                              │
                 ┌────────────┼────────────┐
                 ▼            ▼            ▼
    ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
    │ 2.1 Save System │ │ 2.2 Position    │ │ 2.3 Content      │
    │                 │ │     Bridge       │ │     Provider     │
    ├──────────────────┤ ├──────────────────┤ ├──────────────────┤
    │ • onSave handler│ │ • CSS transforms │ │ • Read from cache│
    │ • File API call │ │ • React portals  │ │ • Pass to editor │
    │ • Error handling│ │ • Viewport events│ │ • Initial content│
    └──────────────────┘ └──────────────────┘ └──────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                   PHASE 3: Integration                       │
│                  (Depends on Phase 2)                        │
└─────────────────────────────────────────────────────────────┘
                              │
                 ┌────────────┴────────────┐
                 ▼                         ▼
    ┌─────────────────────┐     ┌─────────────────────┐
    │  3.1 File Watcher   │     │  3.2 Graph Update   │
    │     Integration     │     │      Integration    │
    ├─────────────────────┤     ├─────────────────────┤
    │ • Detect saves      │     │ • Update node data  │
    │ • Update cache      │     │ • Refresh editors   │
    │ • Trigger re-render │     │ • Sync visual state │
    └─────────────────────┘     └─────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                 PHASE 4: Enhanced Positioning                │
│              (Can start after Phase 2.2)                     │
└─────────────────────────────────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│ 4.1 Drag Support│ │ 4.2 Performance  │ │ 4.3 Multi-Editor │
│                 │ │    Optimization   │ │     Management   │
├──────────────────┤ ├──────────────────┤ ├──────────────────┤
│ • Drag detection│ │ • RAF batching   │ │ • Z-index mgmt   │
│ • Offset update │ │ • Transform cache│ │ • Focus handling │
│ • State persist │ │ • Debounce events│ │ • Minimize/max   │
└──────────────────┘ └──────────────────┘ └──────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    PHASE 5: Testing                          │
│                  (Parallel to Phase 3-4)                     │
└─────────────────────────────────────────────────────────────┘
                              │
                 ┌────────────┼────────────┐
                 ▼            ▼            ▼
    ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
    │ 5.1 Unit Tests  │ │ 5.2 Integration  │ │ 5.3 E2E Tests    │
    │                 │ │      Tests       │ │                  │
    ├──────────────────┤ ├──────────────────┤ ├──────────────────┤
    │ • Editor props  │ │ • Save flow      │ │ • Full workflow  │
    │ • State mgmt    │ │ • File updates   │ │ • User scenarios │
    │ • Positioning   │ │ • Graph sync     │ │ • Playwright     │
    └──────────────────┘ └──────────────────┘ └──────────────────┘
```

### Implementation Status

#### ✅ PHASE 1: Foundation - **COMPLETE**
- **1.1 Editor Props Refactoring**: Removed `filePath` dependency, added `content` and `onSave` props
- **1.2 State Management**: Added comprehensive editor tracking in VoiceTreeLayout with position/content caching

#### ✅ PHASE 2: Core Logic - **COMPLETE**
- **2.1 Save System**: Moved save logic to VoiceTreeLayout with proper callbacks
- **2.2 Positioning Bridge**: Implemented individual positioning system using RAF throttling
- **2.3 Content Provider**: Content properly passed from cache to editors

#### ✅ PHASE 3: Integration - **COMPLETE**
- **3.1 File Watcher**: External file changes update open editors automatically
- **3.2 Graph Updates**: Save → file write → watcher → graph update flow working

#### ⏳ PHASE 4: Enhancements - **PENDING**
- 4.1 Drag Support: Not yet implemented
- 4.2 Performance Optimization: Basic RAF batching done
- 4.3 Multi-Editor Management: Basic support working

#### ✅ PHASE 5: Testing - **COMPLETE FOR PHASES 1-3**
- Unit tests: 83/83 passing
- Integration tests: 18/18 passing
- E2E tests: Full workflow coverage

### Key Architecture Decisions Made

1. **Individual Positioning** over global transforms for better debuggability
2. **Simple left/top CSS** positioning instead of complex transform matrices
3. **RAF throttling** for smooth performance during pan/zoom
4. **Proper separation of concerns** - editors are pure components with no file system knowledge

### Files Modified

- `src/components/floating-windows/editors/MarkdownEditor.tsx` - Pure component with props
- `src/components/floating-windows/FloatingWindow.tsx` - Simplified delegation
- `src/components/floating-windows/FloatingWindowContainer.tsx` - Position update handling
- `src/components/voicetree-layout.tsx` - Central state management and coordination
- `tests/e2e/isolated-with-harness/` - Comprehensive test coverage
- `src/test/mock-electron-api.ts` - Added saveFileContent() for browser mode
- `src/test/setup-browser-tests.ts` - Simplified window detection

## 8. Browser Mode Support Implementation

### What Was Implemented
- **MockElectronAPI** auto-injected in browser when no real Electron API exists
- Example files automatically load when clicking "Open Folder" in browser mode
- Editors work identically in both browser and Electron modes
- Save operations in browser emit file-changed events (simulated, not persisted to disk)

### Architecture Decisions - What We AVOIDED

1. **NO Extra In-Memory Cache in MockElectronAPI**
   - Initially considered storing file contents in MockElectronAPI
   - Rejected because VoiceTreeLayout already has `markdownFiles.current` Map
   - Would have created duplicate state and unnecessary complexity

2. **NO Complex Environment Detection**
   - Avoided complicated DEV/PROD/TEST mode checks
   - Simple rule: if `window.electronAPI` doesn't exist, inject mock
   - Used feature detection pattern instead of environment sniffing

3. **NO Different UI/UX for Browser vs Electron**
   - Both modes look and behave identically to the user
   - "Open Folder" works in both (browser loads examples, Electron opens dialog)
   - Keeps testing realistic and maintenance simple

### Final Data Flow

**Browser Mode:**
```
Editor → VoiceTreeLayout (cache) → MockElectronAPI → Events → Graph
         ↑_______________________________________|
         (file-changed event updates cache)
```

**Electron Mode:**
```
Editor → VoiceTreeLayout (cache) → ElectronAPI → File System
         ↑________________________ Chokidar _______|
         (file watcher detects changes)
```

### UI Cleanup - Remove Duplication

**Current Duplication:**
- Two file watching panels exist in the UI:
  1. **"Live File Watching"** (in App.tsx) - Production component integrated with useGraphManager and graph visualization
  2. **"File Watcher Demo"** (file-watcher-demo.tsx) - Debug/demo component showing raw file system events

**Action Required:**
- **KEEP:** "Live File Watching" panel - This is the production feature
- **REMOVE:** "File Watcher Demo" component from App.tsx - It's a debugging tool that creates confusion
- Remove the import and usage of `<FileWatcherDemo />` in App.tsx
- Can keep the component file for debugging if needed, just don't render it in main app

**Why This Matters:**
- Single file watching UI reduces user confusion
- Both components connect to the same file watching system
- The demo was useful during development but not needed in production UI
