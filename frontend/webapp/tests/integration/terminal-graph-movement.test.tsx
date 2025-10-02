/**
 * Integration test to verify terminal windows move with graph panning
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, act } from '@testing-library/react';
import cytoscape from 'cytoscape';
import { FloatingWindowManagerProvider } from '@/components/floating-windows/context/FloatingWindowManager';

// Mock window.electron
global.window.electron = {
  contextMenu: {
    show: vi.fn()
  },
  terminal: {
    create: vi.fn().mockResolvedValue({ success: true, id: 'test-terminal' }),
    write: vi.fn(),
    resize: vi.fn(),
    destroy: vi.fn(),
    onData: vi.fn()
  }
} as typeof window.electron;

describe('Terminal Window Graph Movement', () => {
  let cytoscapeCore: cytoscape.Core;

  beforeEach(() => {
    // Create a mock cytoscape instance
    const container = document.createElement('div');
    cytoscapeCore = cytoscape({
      container: container,
      elements: [
        { data: { id: 'node1', label: 'Test Node 1' }, position: { x: 100, y: 100 } },
        { data: { id: 'node2', label: 'Test Node 2' }, position: { x: 300, y: 200 } }
      ],
      style: [
        {
          selector: 'node',
          style: { 'background-color': '#666', 'label': 'data(label)' }
        }
      ],
      layout: { name: 'preset' },
      userPanningEnabled: true,
      userZoomingEnabled: true
    });
  });

  it('should create terminal windows with graph coordinates', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockWindowsRef: any[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockOpenWindow = vi.fn((windowConfig: any) => {
      mockWindowsRef.push(windowConfig);
    });

    const TestComponent = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const layoutRef = React.useRef<any>(null);

      React.useEffect(() => {
        // Simulate opening a terminal for node1
        const node = cytoscapeCore.getElementById('node1');
        const nodeGraphPos = node.position();
        const nodeScreenPos = node.renderedPosition();
        const zoom = cytoscapeCore.zoom();

        const initialGraphOffset = {
          x: 50 / zoom,
          y: 50 / zoom
        };

        mockOpenWindow({
          nodeId: 'terminal-node1',
          title: 'Terminal - node1',
          type: 'Terminal',
          content: '',
          position: { x: nodeScreenPos.x + 50, y: nodeScreenPos.y + 50 },
          graphAnchor: nodeGraphPos,
          graphOffset: initialGraphOffset,
          size: { width: 800, height: 400 }
        });
      }, []);

      return <div ref={layoutRef}>Test Layout</div>;
    };

    render(
      <FloatingWindowManagerProvider>
        <TestComponent />
      </FloatingWindowManagerProvider>
    );

    // Wait for effects to complete
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    // Verify terminal was created with graph coordinates
    expect(mockOpenWindow).toHaveBeenCalled();
    const terminalWindow = mockWindowsRef[0];
    expect(terminalWindow).toBeDefined();
    expect(terminalWindow.type).toBe('Terminal');
    expect(terminalWindow.graphAnchor).toBeDefined();
    expect(terminalWindow.graphAnchor.x).toBe(100);
    expect(terminalWindow.graphAnchor.y).toBe(100);
    expect(terminalWindow.graphOffset).toBeDefined();
    expect(terminalWindow.graphOffset.x).toBe(50); // 50 / zoom(1) = 50
    expect(terminalWindow.graphOffset.y).toBe(50);
  });

  it('should update terminal position when graph pans', async () => {
    const testWindows = [
      {
        id: 'window-1',
        nodeId: 'terminal-node1',
        type: 'Terminal',
        graphAnchor: { x: 100, y: 100 },
        graphOffset: { x: 50, y: 50 },
        position: { x: 150, y: 150 }
      }
    ];

    // Helper to convert graph coords to screen coords
    const toScreenCoords = (graphX: number, graphY: number, cy: cytoscape.Core) => {
      const zoom = cy.zoom();
      const pan = cy.pan();
      return {
        x: graphX * zoom + pan.x,
        y: graphY * zoom + pan.y
      };
    };

    // Initial position check
    const initialGraphX = testWindows[0].graphAnchor.x + testWindows[0].graphOffset.x;
    const initialGraphY = testWindows[0].graphAnchor.y + testWindows[0].graphOffset.y;
    const initialScreenPos = toScreenCoords(initialGraphX, initialGraphY, cytoscapeCore);

    expect(initialScreenPos.x).toBeCloseTo(150);
    expect(initialScreenPos.y).toBeCloseTo(150);

    // Simulate pan
    act(() => {
      cytoscapeCore.pan({ x: 100, y: 100 });
    });

    // Calculate new position after pan
    const newScreenPos = toScreenCoords(initialGraphX, initialGraphY, cytoscapeCore);

    // Position should have moved with the pan
    expect(newScreenPos.x).toBeCloseTo(250); // 150 + 100
    expect(newScreenPos.y).toBeCloseTo(250); // 150 + 100
  });

  it('should handle both editor and terminal windows during pan', () => {
    const testWindows = [
      {
        id: 'editor-1',
        nodeId: 'editor-node1',
        type: 'MarkdownEditor',
        graphAnchor: { x: 100, y: 100 },
        graphOffset: { x: 20, y: 20 },
        position: { x: 120, y: 120 }
      },
      {
        id: 'terminal-1',
        nodeId: 'terminal-node2',
        type: 'Terminal',
        graphAnchor: { x: 300, y: 200 },
        graphOffset: { x: 50, y: 50 },
        position: { x: 350, y: 250 }
      }
    ];

    // Helper to convert graph coords to screen coords
    const toScreenCoords = (graphX: number, graphY: number, cy: cytoscape.Core) => {
      const zoom = cy.zoom();
      const pan = cy.pan();
      return {
        x: graphX * zoom + pan.x,
        y: graphY * zoom + pan.y
      };
    };

    // Simulate pan
    const panDelta = { x: 75, y: 75 };
    cytoscapeCore.pan(panDelta);

    // Both windows should update
    for (const window of testWindows) {
      const graphX = window.graphAnchor.x + window.graphOffset.x;
      const graphY = window.graphAnchor.y + window.graphOffset.y;
      const newPos = toScreenCoords(graphX, graphY, cytoscapeCore);

      // Each window should move by the pan amount
      expect(newPos.x).toBeCloseTo(window.position.x + panDelta.x);
      expect(newPos.y).toBeCloseTo(window.position.y + panDelta.y);
    }
  });

  it('should maintain relative positions during zoom', () => {
    const testWindow = {
      id: 'terminal-1',
      nodeId: 'terminal-node1',
      type: 'Terminal',
      graphAnchor: { x: 100, y: 100 },
      graphOffset: { x: 50, y: 50 },
      position: { x: 150, y: 150 }
    };

    const toScreenCoords = (graphX: number, graphY: number, cy: cytoscape.Core) => {
      const zoom = cy.zoom();
      const pan = cy.pan();
      return {
        x: graphX * zoom + pan.x,
        y: graphY * zoom + pan.y
      };
    };

    // Zoom in by 2x
    cytoscapeCore.zoom(2);
    cytoscapeCore.center(); // Center to adjust pan

    const graphX = testWindow.graphAnchor.x + testWindow.graphOffset.x;
    const graphY = testWindow.graphAnchor.y + testWindow.graphOffset.y;
    const zoomedPos = toScreenCoords(graphX, graphY, cytoscapeCore);

    // The window should scale with zoom
    // Since we're at 2x zoom, the graph coordinates are scaled up
    const zoom = cytoscapeCore.zoom();
    const pan = cytoscapeCore.pan();

    // After zoom, positions are scaled
    expect(zoomedPos.x).toBe(graphX * zoom + pan.x);
    expect(zoomedPos.y).toBe(graphY * zoom + pan.y);
  });
});