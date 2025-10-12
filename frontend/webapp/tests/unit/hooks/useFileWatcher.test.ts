import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFileWatcher } from '@/hooks/useFileWatcher';
import { CytoscapeCore } from '@/graph-core';
import type { LayoutManager } from '@/graph-core/graphviz/layout';
import type { Core as CytoscapeCoreMock } from 'cytoscape';

// Mock types for Cytoscape collections and elements
interface MockEdge {
  id: () => string;
  data: (key?: string) => unknown;
  target: () => unknown;
}

interface MockEdgeCollection {
  length: number;
  forEach: (callback: (edge: MockEdge) => void) => void;
  filter: (predicate: (edge: MockEdge) => boolean) => MockEdgeCollection;
  remove: () => void;
}

describe('useFileWatcher', () => {
  let mockCytoscapeRef: React.RefObject<CytoscapeCore | null>;
  let mockMarkdownFiles: React.MutableRefObject<Map<string, string>>;
  let mockLayoutManagerRef: React.MutableRefObject<LayoutManager | null>;
  let mockSetNodeCount: ReturnType<typeof vi.fn>;
  let mockSetEdgeCount: ReturnType<typeof vi.fn>;
  let mockSetIsInitialLoad: ReturnType<typeof vi.fn>;
  let mockCyCore: Partial<CytoscapeCoreMock>;

  beforeEach(() => {
    // Create a mock Cytoscape core with necessary methods
    mockCyCore = {
      add: vi.fn((config) => {
        if (config.group === 'nodes') {
          return {
            id: () => config.data.id,
            data: vi.fn((key?: string, value?: unknown) => {
              if (key && value !== undefined) {
                config.data[key] = value;
              }
              return key ? config.data[key] : config.data;
            }),
            removeData: vi.fn(),
            length: 1
          };
        }
        return { length: 1 };
      }),
      getElementById: vi.fn((id: string) => ({
        length: 0, // By default, nodes don't exist
        id: () => id,
        data: vi.fn(() => undefined),
        removeData: vi.fn(),
        position: () => ({ x: 100, y: 100 })
      })),
      edges: vi.fn(() => {
        // Return mock edge collection with remove method
        return {
          length: 0,
          remove: vi.fn(),
          filter: vi.fn()
        };
      }),
      nodes: vi.fn(() => ({
        length: 0,
        forEach: vi.fn()
      })),
      elements: vi.fn(() => ({
        length: 0,
        remove: vi.fn()
      })),
      width: vi.fn(() => 800),
      height: vi.fn(() => 600),
      fit: vi.fn()
    };

    // Mock CytoscapeCore instance
    const mockCytoscapeCore = {
      getCore: () => mockCyCore,
      animateAppendedContent: vi.fn(),
      animateNewNode: vi.fn(),
      setAnimationTimeout: vi.fn()
    } as unknown as CytoscapeCore;

    mockCytoscapeRef = { current: mockCytoscapeCore };
    mockMarkdownFiles = { current: new Map() };
    mockLayoutManagerRef = { current: null };
    mockSetNodeCount = vi.fn();
    mockSetEdgeCount = vi.fn();
    mockSetIsInitialLoad = vi.fn();
  });

  describe('handleFileChanged - Ghost Node Edge Preservation', () => {
    it('should NOT remove edges to ghost nodes (floating windows) when file changes', () => {
      // Setup: Create a regular node and a ghost node with edge
      const nodeId = 'test-node';
      const ghostNodeId = 'terminal-test-node';
      const edgeId = `edge-${nodeId}-${ghostNodeId}`;

      // Mock getElementById to return existing nodes
      mockCyCore.getElementById = vi.fn((id: string) => {
        if (id === nodeId) {
          return {
            length: 1,
            id: () => nodeId,
            data: vi.fn((key?: string, value?: unknown) => {
              if (key && value !== undefined) {
                // Setter
                return;
              }
              if (key === 'linkedNodeIds') return ['other-node'];
              return undefined;
            }),
            removeData: vi.fn(),
            position: () => ({ x: 100, y: 100 })
          };
        }
        if (id === ghostNodeId) {
          return {
            length: 1,
            id: () => ghostNodeId,
            data: vi.fn((key?: string) => {
              if (key === 'isFloatingWindow') return true;
              if (key === 'parentNodeId') return nodeId;
              return undefined;
            }),
            removeData: vi.fn(),
            position: () => ({ x: 100, y: 100 })
          };
        }
        if (id === 'other-node') {
          return {
            length: 1,
            id: () => 'other-node',
            data: vi.fn((key?: string) => {
              if (key === 'isFloatingWindow') return false;
              return undefined;
            }),
            removeData: vi.fn(),
            position: () => ({ x: 100, y: 100 })
          };
        }
        return { length: 0, data: vi.fn(), removeData: vi.fn(), position: () => ({ x: 100, y: 100 }) };
      });

      // Mock edges selector to track which edges get removed
      const removedEdges: string[] = [];
      mockCyCore.edges = vi.fn((selector?: string) => {
        if (selector === `[source = "${nodeId}"]`) {
          // This selector would match ALL edges from nodeId
          // Including both regular edges AND ghost node edges
          const regularEdge = {
            id: () => `${nodeId}->other-node`,
            data: vi.fn((key?: string) => {
              if (key === 'source') return nodeId;
              if (key === 'target') return 'other-node';
              return undefined;
            }),
            target: () => mockCyCore.getElementById('other-node')
          };
          const ghostEdge = {
            id: () => edgeId,
            data: vi.fn((key?: string) => {
              if (key === 'source') return nodeId;
              if (key === 'target') return ghostNodeId;
              return undefined;
            }),
            target: () => mockCyCore.getElementById(ghostNodeId)
          };

          const allEdges = [regularEdge, ghostEdge];

          return {
            length: 2,
            forEach: (callback: (edge: MockEdge) => void) => {
              allEdges.forEach(callback);
            },
            filter: (predicate: (edge: MockEdge) => boolean) => {
              const filtered = allEdges.filter(predicate);
              return {
                length: filtered.length,
                forEach: (callback: (edge: MockEdge) => void) => {
                  filtered.forEach(callback);
                },
                remove: vi.fn(function(this: MockEdgeCollection) {
                  this.forEach((edge: MockEdge) => {
                    removedEdges.push(edge.id());
                  });
                })
              };
            },
            remove: vi.fn(function(this: MockEdgeCollection) {
              // Track all edges that would be removed
              this.forEach((edge: MockEdge) => {
                removedEdges.push(edge.id());
              });
            })
          };
        }
        return { length: 0, remove: vi.fn(), forEach: vi.fn(), filter: vi.fn() };
      });

      // Render the hook
      const { result } = renderHook(() =>
        useFileWatcher({
          cytoscapeRef: mockCytoscapeRef,
          markdownFiles: mockMarkdownFiles,
          layoutManagerRef: mockLayoutManagerRef,
          isInitialLoad: false,
          setNodeCount: mockSetNodeCount,
          setEdgeCount: mockSetEdgeCount,
          setIsInitialLoad: mockSetIsInitialLoad
        })
      );

      // Simulate file change for the parent node
      result.current.handleFileChanged({
        path: 'test-node.md',
        fullPath: '/path/to/test-node.md',
        content: '# Test Node\n\n- some_link [[other-node]]'
      });

      // ASSERTION: The ghost node edge should NOT be removed
      // This test will FAIL with the current implementation because
      // handleFileChanged removes ALL edges from the source node
      expect(removedEdges).toContain(`${nodeId}->other-node`); // Regular edge should be removed
      expect(removedEdges).not.toContain(edgeId); // Ghost node edge should NOT be removed
    });

    it('should preserve edges where target has isFloatingWindow=true', () => {
      const nodeId = 'parent-node';
      const editorId = 'editor-parent-node';

      // Mock getElementById to simulate existing nodes
      mockCyCore.getElementById = vi.fn((id: string) => {
        if (id === nodeId) {
          return {
            length: 1,
            id: () => nodeId,
            data: vi.fn((key?: string, value?: unknown) => {
              if (key && value !== undefined) {
                // Setter
                return;
              }
              if (key === 'linkedNodeIds') return [];
              return undefined;
            }),
            removeData: vi.fn(),
            position: () => ({ x: 100, y: 100 })
          };
        }
        if (id === editorId) {
          return {
            length: 1,
            id: () => editorId,
            data: vi.fn((key?: string) => {
              if (key === 'isFloatingWindow') return true;
              if (key === 'parentNodeId') return nodeId;
              return undefined;
            }),
            removeData: vi.fn(),
            position: () => ({ x: 100, y: 100 })
          };
        }
        return { length: 0, data: vi.fn(), removeData: vi.fn(), position: () => ({ x: 100, y: 100 }) };
      });

      // Mock edges to return an editor edge
      const removedEdges: string[] = [];
      mockCyCore.edges = vi.fn((selector?: string) => {
        if (selector === `[source = "${nodeId}"]`) {
          const editorEdge = {
            id: () => `edge-${nodeId}-${editorId}`,
            data: vi.fn((key?: string) => {
              if (key === 'source') return nodeId;
              if (key === 'target') return editorId;
              return undefined;
            }),
            target: () => mockCyCore.getElementById(editorId)
          };

          const allEdges = [editorEdge];

          return {
            length: 1,
            forEach: (callback: (edge: MockEdge) => void) => {
              allEdges.forEach(callback);
            },
            filter: (predicate: (edge: MockEdge) => boolean) => {
              const filtered = allEdges.filter(predicate);
              return {
                length: filtered.length,
                forEach: (callback: (edge: MockEdge) => void) => {
                  filtered.forEach(callback);
                },
                remove: vi.fn(function(this: MockEdgeCollection) {
                  this.forEach((edge: MockEdge) => {
                    removedEdges.push(edge.id());
                  });
                })
              };
            },
            remove: vi.fn(function(this: MockEdgeCollection) {
              this.forEach((edge: MockEdge) => {
                removedEdges.push(edge.id());
              });
            })
          };
        }
        return { length: 0, remove: vi.fn(), forEach: vi.fn(), filter: vi.fn() };
      });

      const { result } = renderHook(() =>
        useFileWatcher({
          cytoscapeRef: mockCytoscapeRef,
          markdownFiles: mockMarkdownFiles,
          layoutManagerRef: mockLayoutManagerRef,
          isInitialLoad: false,
          setNodeCount: mockSetNodeCount,
          setEdgeCount: mockSetEdgeCount,
          setIsInitialLoad: mockSetIsInitialLoad
        })
      );

      // Trigger file change
      result.current.handleFileChanged({
        path: 'parent-node.md',
        fullPath: '/path/to/parent-node.md',
        content: '# Parent Node\n\nSome content'
      });

      // Editor edge should NOT be removed
      expect(removedEdges).not.toContain(`edge-${nodeId}-${editorId}`);
    });

    it('should remove regular markdown edges when file changes', () => {
      const nodeId = 'node-with-links';
      const targetId = 'linked-node';

      mockCyCore.getElementById = vi.fn((id: string) => {
        if (id === nodeId) {
          return {
            length: 1,
            id: () => nodeId,
            data: vi.fn((key?: string, value?: unknown) => {
              if (key && value !== undefined) {
                // Setter
                return;
              }
              if (key === 'linkedNodeIds') return [targetId];
              return undefined;
            }),
            removeData: vi.fn(),
            position: () => ({ x: 100, y: 100 })
          };
        }
        if (id === targetId) {
          return {
            length: 1,
            id: () => targetId,
            data: vi.fn((key?: string) => {
              if (key === 'isFloatingWindow') return false;
              return undefined;
            }),
            removeData: vi.fn(),
            position: () => ({ x: 100, y: 100 })
          };
        }
        return { length: 0, data: vi.fn(), removeData: vi.fn(), position: () => ({ x: 100, y: 100 }) };
      });

      const removedEdges: string[] = [];
      mockCyCore.edges = vi.fn((selector?: string) => {
        if (selector === `[source = "${nodeId}"]`) {
          const regularEdge = {
            id: () => `${nodeId}->${targetId}`,
            data: vi.fn((key?: string) => {
              if (key === 'source') return nodeId;
              if (key === 'target') return targetId;
              return undefined;
            }),
            target: () => mockCyCore.getElementById(targetId)
          };

          const allEdges = [regularEdge];

          return {
            length: 1,
            forEach: (callback: (edge: MockEdge) => void) => {
              allEdges.forEach(callback);
            },
            filter: (predicate: (edge: MockEdge) => boolean) => {
              const filtered = allEdges.filter(predicate);
              return {
                length: filtered.length,
                forEach: (callback: (edge: MockEdge) => void) => {
                  filtered.forEach(callback);
                },
                remove: vi.fn(function(this: MockEdgeCollection) {
                  this.forEach((edge: MockEdge) => {
                    removedEdges.push(edge.id());
                  });
                })
              };
            },
            remove: vi.fn(function(this: MockEdgeCollection) {
              this.forEach((edge: MockEdge) => {
                removedEdges.push(edge.id());
              });
            })
          };
        }
        return { length: 0, remove: vi.fn(), forEach: vi.fn(), filter: vi.fn() };
      });

      const { result } = renderHook(() =>
        useFileWatcher({
          cytoscapeRef: mockCytoscapeRef,
          markdownFiles: mockMarkdownFiles,
          layoutManagerRef: mockLayoutManagerRef,
          isInitialLoad: false,
          setNodeCount: mockSetNodeCount,
          setEdgeCount: mockSetEdgeCount,
          setIsInitialLoad: mockSetIsInitialLoad
        })
      );

      result.current.handleFileChanged({
        path: 'node-with-links.md',
        fullPath: '/path/to/node-with-links.md',
        content: '# Node\n\n- link [[different-node]]'
      });

      // Regular markdown edges SHOULD be removed (to be re-added with updated content)
      expect(removedEdges).toContain(`${nodeId}->${targetId}`);
    });
  });

  describe('handleFileAdded - Viewport Fitting', () => {
    it('should call cy.fit() with padding when adding the first node (0→1 transition)', () => {
      // Setup: Mock cy.fit() to track calls
      const mockFit = vi.fn();
      mockCyCore.fit = mockFit;

      // Mock nodes().length to return 1 after adding the first node
      mockCyCore.nodes = vi.fn(() => ({
        length: 1,
        forEach: vi.fn()
      }));

      const { result } = renderHook(() =>
        useFileWatcher({
          cytoscapeRef: mockCytoscapeRef,
          markdownFiles: mockMarkdownFiles,
          layoutManagerRef: mockLayoutManagerRef,
          isInitialLoad: false,
          setNodeCount: mockSetNodeCount,
          setEdgeCount: mockSetEdgeCount,
          setIsInitialLoad: mockSetIsInitialLoad
        })
      );

      // Add the first file (0→1 transition)
      result.current.handleFileAdded({
        path: 'first-node.md',
        fullPath: '/path/to/first-node.md',
        content: '# First Node\n\nSome content'
      });

      // Verify cy.fit() was called with padding of 100
      expect(mockFit).toHaveBeenCalledWith(undefined, 100);
    });

    it('should NOT call cy.fit() when adding the second node (1→2 transition)', () => {
      // Setup: Mock cy.fit() to track calls
      const mockFit = vi.fn();
      mockCyCore.fit = mockFit;

      // Mock nodes().length to return 2 after adding the second node
      mockCyCore.nodes = vi.fn(() => ({
        length: 2,
        forEach: vi.fn()
      }));

      const { result } = renderHook(() =>
        useFileWatcher({
          cytoscapeRef: mockCytoscapeRef,
          markdownFiles: mockMarkdownFiles,
          layoutManagerRef: mockLayoutManagerRef,
          isInitialLoad: false,
          setNodeCount: mockSetNodeCount,
          setEdgeCount: mockSetEdgeCount,
          setIsInitialLoad: mockSetIsInitialLoad
        })
      );

      // Add a file when graph already has nodes (1→2 transition)
      result.current.handleFileAdded({
        path: 'second-node.md',
        fullPath: '/path/to/second-node.md',
        content: '# Second Node\n\nSome content'
      });

      // Verify cy.fit() was NOT called
      expect(mockFit).not.toHaveBeenCalled();
    });
  });
});
