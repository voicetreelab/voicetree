import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerFloatingWindows } from '@/graph-core/extensions/cytoscape-floating-windows';
import type cytoscape from 'cytoscape';

describe('Cytoscape Floating Windows Extension - Vanilla JS', () => {
  let mockCytoscape: typeof cytoscape;
  let mockCore: cytoscape.Core;
  let mockContainer: HTMLElement;
  let mockParent: HTMLElement;

  beforeEach(() => {
    // Setup DOM
    mockContainer = document.createElement('div');
    mockParent = document.createElement('div');
    mockParent.appendChild(mockContainer);
    document.body.appendChild(mockParent);

    // Mock ResizeObserver
    global.ResizeObserver = vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn()
    }));

    // Mock Cytoscape core methods
    mockCore = {
      container: vi.fn(() => mockContainer),
      add: vi.fn((config) => {
        const mockNode = {
          id: () => config.data.id,
          position: vi.fn(() => config.position || { x: 0, y: 0 }),
          style: vi.fn(),
          on: vi.fn(),
          length: 1
        };
        return mockNode as unknown as cytoscape.NodeSingular;
      }),
      $: vi.fn((selector: string) => {
        const mockCollection = {
          length: 0,
          remove: vi.fn()
        };
        return mockCollection as unknown as cytoscape.NodeCollection;
      }),
      on: vi.fn(),
      pan: vi.fn(() => ({ x: 0, y: 0 })),
      zoom: vi.fn(() => 1),
      trigger: vi.fn()
    } as unknown as cytoscape.Core;

    // Mock cytoscape constructor/function
    mockCytoscape = vi.fn((type: string, name: string, extension: unknown) => {
      // Store the extension function for later use
      if (type === 'core' && name === 'addFloatingWindow') {
        (mockCore as unknown as Record<string, unknown>).addFloatingWindow = extension;
      }
    }) as unknown as typeof cytoscape;
  });

  it('should register extension without requiring config', () => {
    // Should not throw - no config needed anymore
    expect(() => {
      registerFloatingWindows(mockCytoscape);
    }).not.toThrow();
  });

  it('should add addFloatingWindow method to cytoscape core', () => {
    registerFloatingWindows(mockCytoscape);

    const addFloatingWindow = (mockCore as unknown as Record<string, unknown>).addFloatingWindow;
    expect(addFloatingWindow).toBeDefined();
    expect(typeof addFloatingWindow).toBe('function');
  });

  it('should throw error for unknown component', () => {
    registerFloatingWindows(mockCytoscape);

    const addFloatingWindow = (mockCore as unknown as Record<string, unknown>).addFloatingWindow as (
      config: unknown
    ) => cytoscape.NodeSingular;

    expect(() => {
      addFloatingWindow.call(mockCore, {
        id: 'test-window',
        component: 'UnknownComponent',
        position: { x: 100, y: 100 }
      });
    }).toThrow(/not found.*Available.*Terminal.*MarkdownEditor.*TestComponent/);
  });

  it('should create shadow node and window DOM element for Terminal', () => {
    registerFloatingWindows(mockCytoscape);

    const addFloatingWindow = (mockCore as unknown as Record<string, unknown>).addFloatingWindow as (
      config: unknown
    ) => cytoscape.NodeSingular;

    const node = addFloatingWindow.call(mockCore, {
      id: 'terminal-window',
      component: 'Terminal',
      title: 'Test Terminal',
      position: { x: 100, y: 100 },
      nodeMetadata: { nodeId: 'test-node' }
    });

    // Verify shadow node was created
    expect(mockCore.add).toHaveBeenCalledWith(
      expect.objectContaining({
        group: 'nodes',
        data: expect.objectContaining({ id: 'terminal-window' }),
        position: { x: 100, y: 100 }
      })
    );

    // Verify node was returned
    expect(node).toBeDefined();
    expect(node.id()).toBe('terminal-window');

    // Verify window DOM element was created
    const windowElement = mockParent.querySelector('#window-terminal-window');
    expect(windowElement).toBeTruthy();
    expect(windowElement?.classList.contains('cy-floating-window')).toBe(true);
  });

  it('should create shadow node and window DOM element for MarkdownEditor', () => {
    registerFloatingWindows(mockCytoscape);

    const addFloatingWindow = (mockCore as unknown as Record<string, unknown>).addFloatingWindow as (
      config: unknown
    ) => cytoscape.NodeSingular;

    const node = addFloatingWindow.call(mockCore, {
      id: 'editor-window',
      component: 'MarkdownEditor',
      title: 'Test Editor',
      position: { x: 200, y: 200 },
      initialContent: 'Test content'
    });

    // Verify shadow node was created
    expect(mockCore.add).toHaveBeenCalledWith(
      expect.objectContaining({
        group: 'nodes',
        data: expect.objectContaining({ id: 'editor-window' }),
        position: { x: 200, y: 200 }
      })
    );

    // Verify window DOM element was created
    const windowElement = mockParent.querySelector('#window-editor-window');
    expect(windowElement).toBeTruthy();
  });

  it('should create shadow node and window DOM element for TestComponent', () => {
    registerFloatingWindows(mockCytoscape);

    const addFloatingWindow = (mockCore as unknown as Record<string, unknown>).addFloatingWindow as (
      config: unknown
    ) => cytoscape.NodeSingular;

    const node = addFloatingWindow.call(mockCore, {
      id: 'test-window',
      component: 'TestComponent',
      title: 'Test Window',
      position: { x: 150, y: 150 }
    });

    // Verify shadow node was created
    expect(mockCore.add).toHaveBeenCalledWith(
      expect.objectContaining({
        group: 'nodes',
        data: expect.objectContaining({ id: 'test-window' }),
        position: { x: 150, y: 150 }
      })
    );

    // Verify window DOM element was created
    const windowElement = mockParent.querySelector('#window-test-window');
    expect(windowElement).toBeTruthy();

    // Verify TestComponent content was rendered
    const testContent = windowElement?.querySelector('h1');
    expect(testContent?.textContent).toBe('Test Component');
  });

  it('should set correct default dimensions based on component type', () => {
    registerFloatingWindows(mockCytoscape);

    const addFloatingWindow = (mockCore as unknown as Record<string, unknown>).addFloatingWindow as (
      config: unknown
    ) => cytoscape.NodeSingular;

    // Terminal should be larger
    const terminalNode = addFloatingWindow.call(mockCore, {
      id: 'terminal-1',
      component: 'Terminal',
      title: 'Terminal',
      position: { x: 0, y: 0 },
      nodeMetadata: { nodeId: 'test-node' }
    });

    expect((terminalNode as unknown as { style: ReturnType<typeof vi.fn> }).style).toHaveBeenCalledWith(
      expect.objectContaining({
        width: 400,
        height: 600
      })
    );

    // MarkdownEditor should be medium
    const editorNode = addFloatingWindow.call(mockCore, {
      id: 'editor-1',
      component: 'MarkdownEditor',
      title: 'Editor',
      position: { x: 0, y: 0 }
    });

    expect((editorNode as unknown as { style: ReturnType<typeof vi.fn> }).style).toHaveBeenCalledWith(
      expect.objectContaining({
        width: 400,
        height: 400
      })
    );

    // TestComponent should be small
    const testNode = addFloatingWindow.call(mockCore, {
      id: 'test-1',
      component: 'TestComponent',
      title: 'Test',
      position: { x: 0, y: 0 }
    });

    expect((testNode as unknown as { style: ReturnType<typeof vi.fn> }).style).toHaveBeenCalledWith(
      expect.objectContaining({
        width: 200,
        height: 150
      })
    );
  });

  it('should respect custom shadowNodeDimensions if provided', () => {
    registerFloatingWindows(mockCytoscape);

    const addFloatingWindow = (mockCore as unknown as Record<string, unknown>).addFloatingWindow as (
      config: unknown
    ) => cytoscape.NodeSingular;

    const node = addFloatingWindow.call(mockCore, {
      id: 'custom-dimensions',
      component: 'TestComponent',
      title: 'Custom',
      position: { x: 0, y: 0 },
      shadowNodeDimensions: { width: 500, height: 300 }
    });

    expect((node as unknown as { style: ReturnType<typeof vi.fn> }).style).toHaveBeenCalledWith(
      expect.objectContaining({
        width: 500,
        height: 300
      })
    );
  });

  it('should create edge when parentNodeId is provided', () => {
    registerFloatingWindows(mockCytoscape);

    const addFloatingWindow = (mockCore as unknown as Record<string, unknown>).addFloatingWindow as (
      config: unknown
    ) => cytoscape.NodeSingular;

    addFloatingWindow.call(mockCore, {
      id: 'child-window',
      component: 'TestComponent',
      title: 'Child',
      position: { x: 0, y: 0 },
      nodeData: { parentNodeId: 'parent-node' }
    });

    // Verify edge was created
    expect(mockCore.add).toHaveBeenCalledWith(
      expect.objectContaining({
        group: 'edges',
        data: expect.objectContaining({
          source: 'parent-node',
          target: 'child-window'
        })
      })
    );
  });

  it('should create window with title bar and close button', () => {
    registerFloatingWindows(mockCytoscape);

    const addFloatingWindow = (mockCore as unknown as Record<string, unknown>).addFloatingWindow as (
      config: unknown
    ) => cytoscape.NodeSingular;

    addFloatingWindow.call(mockCore, {
      id: 'titled-window',
      component: 'TestComponent',
      title: 'My Window Title',
      position: { x: 0, y: 0 }
    });

    const windowElement = mockParent.querySelector('#window-titled-window');
    expect(windowElement).toBeTruthy();

    // Check title bar
    const titleBar = windowElement?.querySelector('.cy-floating-window-title');
    expect(titleBar).toBeTruthy();

    // Check title text
    const titleText = titleBar?.querySelector('.cy-floating-window-title-text');
    expect(titleText?.textContent).toBe('My Window Title');

    // Check close button
    const closeButton = titleBar?.querySelector('.cy-floating-window-close');
    expect(closeButton).toBeTruthy();
    expect(closeButton?.textContent).toBe('×');
  });

  it('should create shared overlay container for all windows', () => {
    registerFloatingWindows(mockCytoscape);

    const addFloatingWindow = (mockCore as unknown as Record<string, unknown>).addFloatingWindow as (
      config: unknown
    ) => cytoscape.NodeSingular;

    // Create first window
    addFloatingWindow.call(mockCore, {
      id: 'window-1',
      component: 'TestComponent',
      title: 'Window 1',
      position: { x: 0, y: 0 }
    });

    // Verify overlay was created
    const overlay1 = mockParent.querySelector('.cy-floating-overlay');
    expect(overlay1).toBeTruthy();

    // Create second window
    addFloatingWindow.call(mockCore, {
      id: 'window-2',
      component: 'TestComponent',
      title: 'Window 2',
      position: { x: 100, y: 100 }
    });

    // Verify only one overlay exists (shared)
    const overlays = mockParent.querySelectorAll('.cy-floating-overlay');
    expect(overlays.length).toBe(1);

    // Verify both windows are in the same overlay
    const window1 = overlay1?.querySelector('#window-window-1');
    const window2 = overlay1?.querySelector('#window-window-2');
    expect(window1).toBeTruthy();
    expect(window2).toBeTruthy();
  });
});
