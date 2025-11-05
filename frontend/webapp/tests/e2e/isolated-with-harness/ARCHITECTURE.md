# VoiceTree Editor-File-Graph Architecture

## Overview

The VoiceTree webapp implements a bidirectional data flow system between markdown editors, file system, and graph visualization. This document describes the architecture and data flow patterns discovered through test analysis.

## Core Architecture

```
Editor ↔ Indirection Layer (electronAPI) ↔ Files/Mock ↔ Graph Data ↔ Graph Visualization
```

## Components

### 1. Editor Layer
- **Location**: `src/components/floating-windows/editors/MarkdownEditor.tsx`
- **Purpose**: Provides markdown editing interface with live preview
- **Key Features**:
  - Floating windows that track cytoscape node positions
  - Save functionality through `onSave` callback
  - Content synchronization with external file changes

### 2. Indirection Layer (electronAPI)
- **Location**: `window.electronAPI` (injected by Electron or mock)
- **Purpose**: Abstracts file system operations for cross-platform compatibility
- **Implementations**:
  - **Electron Mode**: Real file system access via IPC
  - **Browser Mode**: Mock API (`src/test/mock-electron-api.ts`)
- **Current Initialization**: `src/App.tsx` (lines 9-18)
- **Key Methods**:
  - `saveFileContent(filePath, content)`: Write file content
  - `onFileAdded/Changed/Deleted`: File watcher event listeners

### 3. File System Layer
- **Electron**: Direct file system access with chokidar-based watcher
- **Browser/Tests**: In-memory mock file system
- **File Watcher Events**:
  - File added/changed/deleted
  - Directory added/deleted
  - Initial scan complete

### 4. Graph Data Layer
- **Parser**: `src/graph-core/data/load_markdown/MarkdownParser.ts`
- **Manager**: `src/hooks/useFolderWatcher.tsx`
- **Transformation Pipeline**:
  1. Parse markdown files (extract frontmatter, links)
  2. Generate graph nodes (idAndFilePath, label, linkedNodeIds)
  3. Generate graph outgoingEdges from links
  4. Update cytoscape visualization

### 5. Graph Visualization
- **Core**: `src/graph-core/CytoscapeCore.ts`
- **Layout**: `voicetree-layout.tsx`
- **Node Interaction**: Tap events open floating editors (lines 442-484)

## Data Flow Patterns

### Pattern 1: Editor Save → Graph Update

```
1. User edits content in MarkdownEditor
2. User clicks Save → triggers onSave callback
3. onSave calls electronAPI.saveFileContent(path, content)
4. File system updates (real or mock)
5. File watcher emits 'file-changed' event
6. MarkdownParser extracts title from frontmatter
7. Graph node label updates to new title
8. Cytoscape re-renders with updated label
```

### Pattern 2: External File Change → Editor Update

```
1. External process modifies markdown file
2. File watcher detects change
3. Emits 'file-changed' event with new content
4. Open editors check if they're editing that file
5. If match, editor content updates automatically
6. Graph also updates via same event
```

### Pattern 3: Node Tap → Editor Open

```
1. User clicks cytoscape node
2. Tap event handler triggered (voicetree-layout.tsx:443)
3. Checks if editor already open for node
4. Retrieves file content from markdownFiles map
5. Opens floating window with:
   - Node position for initial placement
   - File content for editing
   - Save callback wired to electronAPI
```

## Test Harness Architecture

The test harness (`floating-editor-harness.tsx`) provides three modes:

### 1. Standalone Mode
- Simple editor without graph
- Tests basic editor functionality

### 2. Cytoscape Mode
- Full cytoscape graph with floating editors
- Tests positioning during pan/zoom/drag

### 3. File-Watcher Mode
- Simulates complete file watching system
- Tests bidirectional data flow
- Includes mock graph manager for node updates

## Key Architectural Decisions

### Strengths
1. **Clean separation of concerns** via indirection layer
2. **Testable** - mock implementations for browser environment
3. **Reactive** - file changes automatically propagate
4. **Consistent** - single source of truth (file system)

### Potential Improvements
1. **Mock API initialization** could move from App.tsx to a more appropriate location (closer to editor creation or in a context provider)
2. **File content caching** in markdownFiles.current map could be managed more centrally
3. **Editor state management** could use a more formalized store pattern

## Testing Strategy

### Unit Tests
- Individual component behavior
- Parser logic
- Graph transformations

### Integration Tests (`editor-file-graph-integration.spec.ts`)
- Editor save → Graph update flow
- File change → Editor update flow
- Bidirectional round-trip scenarios
- Multiple editor independence

### E2E Tests
- Full app behavior in real browser
- Positioning during graph interactions
- Complex multi-step workflows

## Environment Differences

### Browser/Development
- Mock electronAPI provides in-memory file system
- Custom events simulate file watcher
- Test harness controls all data flow

### Electron/Production
- Real file system access
- Chokidar watches actual directories
- IPC communication with main process
- Persistent storage on disk

## Event Flow Diagram

```
         User Action
              ↓
    ┌─────────────────────┐
    │   Floating Editor   │
    └─────────┬───────────┘
              ↓ Save
    ┌─────────────────────┐
    │    electronAPI      │ ← Indirection Layer
    └─────────┬───────────┘
              ↓
    ┌─────────────────────┐
    │    File System      │
    └─────────┬───────────┘
              ↓ Watch Event
    ┌─────────────────────┐
    │   Event Handlers    │
    └────┬─────────┬──────┘
         ↓         ↓
    ┌────────┐ ┌──────────┐
    │ Editor │ │  Graph   │
    │ Update │ │  Update  │
    └────────┘ └──────────┘
```

## File References

- **Main Layout**: `src/components/voicetree-layout.tsx`
- **Editor Component**: `src/components/floating-windows/editors/MarkdownEditor.tsx`
- **Graph Manager**: `src/hooks/useFolderWatcher.tsx`
- **Mock API**: `src/test/mock-electron-api.ts`
- **Test Harness**: `tests/e2e/isolated-with-harness/floating-editor-harness.tsx`
- **Integration Tests**: `tests/e2e/isolated-with-harness/editor-file-graph-integration.spec.ts`