This is the actual spec I want:

## PRIMARY REQUIREMENT: Real MarkdownEditor Integration

The floating window system MUST work with the actual MarkdownEditor component (`src/components/floating-windows/editors/MarkdownEditor.tsx`). This is the primary use case and the critical test.

**Required Editor Functionality:**
- User can type and edit markdown content
- Save button is clickable and functional
- All pointer events (click, select text, drag selection) work correctly
- No conflicts with graph interactions (pan/zoom don't interfere with editor)
- MDEditor component renders and functions normally

## Core Floating Window Behavior

We want to start simple, any floating window ALWAYS is attached to a node.

I.e. any floatingWindow, can be added to cytoscape with one command. e.g. .addFloatingWindow()


- moves perfectly with that node position updates.
- zooms with graph, staying fixed in graph space.
- any other graph interactions (pans, etc.) also make the floatingWindow move so it's fixed in graph
  space
- can have edges to other nodes in the graph

under the hood this can be supported with a cytoscape node that it has a two way anchor to.


## Phase 2: Resizing

Floating windows should be resizable:

- User can resize windows by dragging edges or corners
- Resizing updates window dimensions (width/height)
- Window maintains position anchor at center during resize
- Resized dimensions persist during pan/zoom operations
- Minimum size constraints (e.g., 100x100px) to prevent unusable windows

## Phase 3: Application Integration

The floating window system must be integrated into the actual application:

- Extension registered in main graph component (`voice-tree-graph-viz-layout.tsx`)
- CSS styles properly loaded and applied
- Extension exported from `graph-core/index.ts`
- Works in the real application, not just isolated tests
- No duplication between test code and implementation code

## Phase 4: Production Validation & Test Cleanup

**CRITICAL:** Tests must validate actual implementation files, not contain inline duplicates.

Requirements:
- Remove ALL inline extension code from test files
- Tests should load/import the real extension from `src/graph-core/extensions/cytoscape-floating-windows.ts`
- Bundle extension for browser test environment (if needed)
- Validate floating windows work in production application
- Verify real MarkdownEditor component integration in live app
- No event conflicts (typing, clicking, selecting text work without graph interference)

