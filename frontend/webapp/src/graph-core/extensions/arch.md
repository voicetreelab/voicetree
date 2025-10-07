⏺ How the New Vanilla DOM System Works

Here's the complete flow:

1. React Component Setup (React code)

// src/components/voice-tree-graph-viz-layout.tsx
const containerRef = useRef<HTMLDivElement>(null);

// React renders a container div:
  <div ref={containerRef} className="cytoscape-container" />

2. Cytoscape Initialization (React → Native)

// When containerRef is available:
cytoscapeRef.current = new CytoscapeCore(container);

This creates a native Cytoscape canvas inside that div.

3. Extension Registration (Pure JavaScript - Module Load Time)

// src/graph-core/index.ts - runs at module load, BEFORE any React renders
registerFloatingWindows(cytoscape, {
React,
ReactDOM,
components: { MarkdownEditor, Terminal, TestComponent }
});

This adds the addFloatingWindow() method to all Cytoscape instances globally.

4. Window Creation (Pure JavaScript - Outside React Tree)

When cy.addFloatingWindow() is called (e.g., from a context menu handler):

// src/graph-core/extensions/cytoscape-floating-windows.ts (lines 332-388)
cytoscape('core', 'addFloatingWindow', function(config) {
// 1. Get cytoscape's container element
const overlay = getOrCreateOverlay(this);  // Creates SIBLING div

    // 2. Create vanilla DOM window chrome
    const { windowElement, contentContainer } = createWindowChrome(this, config);

    // 3. Append to overlay (pure DOM operation, no React)
    overlay.appendChild(windowElement);

    // 4. Mount React as an "island" into contentContainer
    mountComponent(contentContainer, component, id, config);
});

The Key Insight: DOM Structure

The actual DOM structure is:

  <div class="relative">  <!-- React component container -->
    <div ref={containerRef} class="cytoscape-container">
      <canvas><!-- Cytoscape renders here --></canvas>
    </div>

    <div class="cy-floating-overlay">  <!-- Created by vanilla JS, SIBLING to cytoscape-container -->
      <div id="window-editor-1" class="cy-floating-window">  <!-- Vanilla DOM chrome -->
        <div class="cy-floating-window-title">...</div>
        <div class="cy-floating-window-content">
          <!-- React "island" rendered here -->
          <MarkdownEditor />
        </div>
      </div>
    </div>
  </div>

Where is the vanilla DOM setup?

100% in src/graph-core/extensions/cytoscape-floating-windows.ts

- getOrCreateOverlay() - Creates the .cy-floating-overlay sibling div using document.createElement()
- createWindowChrome() - Creates all window structure using document.createElement()
- attachDragHandlers() - Attaches drag listeners using vanilla addEventListener()

There is NO vanilla DOM setup in React code. The React components just:
1. Render a container div for Cytoscape
2. Call cy.addFloatingWindow() (which triggers the extension)
3. Never touch the floating window DOM directly

The Old System's Confusion

The old files you saw (FloatingWindowContainer, FloatingWindowManagerProvider) were trying to:
- Create windows using React state
- Render them in the React tree
- Manage positioning with React state updates

But they're completely bypassed now. The new system creates everything via the Cytoscape extension
using vanilla DOM operations, with React only used for the content inside each window.