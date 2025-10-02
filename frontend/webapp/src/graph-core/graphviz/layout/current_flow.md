window.electron.ipcRenderer.on('file-observer:event', handleFileEvent)
↓
handleFileEvent() calls registered callbacks:
callback(event) for each 'file-added' event
Lines 48-70 in implementation-electron.ts

3. Graph Manager Hook (hooks/useGraphManager-fileobserver.ts)
   useGraphManagerWithFileObserver()
   ↓
   fileObserver.start(directoryPath, callback)
   ↓
   callback receives each 'file-added' event
   ↓
   Lines 92-106: Parses markdown, builds VFile
   ↓
   Lines 112-119: Updates graphData state via setGraphData()
   setGraphData(prev => ({
   nodes: [...prev.nodes, newNode],
   edges: [...prev.edges, ...newEdges]
   }))

4. Graph Viz Component (components/voice-tree-graph-viz-layout.tsx)
   VoiceTreeGraphVizLayout component
   ↓
   const { graphData } = useGraphManagerWithFileObserver()
   ↓
   useEffect(() => { ... }, [graphData, cyRef.current])  // Lines 608-669
   ↓
   Triggers on EVERY graphData change (i.e., every file added)
   ↓
   Line 632: Calls renderGraph(graphData, cyRef.current)
   ↓
   Line 651: After nodes/edges added to Cytoscape:
   if (newNodeIds.length > 0) {
   layoutManager.applyLayout(cy, newNodeIds)
   }

5. Layout Manager (graph-core/graphviz/layout/LayoutManager.ts)
   LayoutManager.applyLayout(cy, newNodeIds)
   ↓
   Line 84: Calls positionNewNodes(cy, newNodeIds, strategy)
   ↓
   Lines 114-156: Gets existing nodes, calculates positions
   ↓
   Line 158: strategy.position(context) → SeedParkRelaxStrategy
   ↓
   Lines 160-178: Applies positions to Cytoscape nodes
   ↓
   Line 185: RUNS LAYOUT: cy.layout(layoutOptions).run()

6. SeedParkRelax Strategy
   SeedParkRelaxStrategy.position()
   ↓
   Uses cola.js force-directed layout <<<------ what? no it doesn't
   ↓
   Returns new positions for nodes


ALTERNATIVE FLOW FOR BULK LOAD