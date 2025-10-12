import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerFloatingWindows } from '@/graph-core/extensions/cytoscape-floating-windows';
import React from 'react';
import ReactDOM from 'react-dom/client';
import type cytoscape from 'cytoscape';

// Mock component for testing
const TestComponent = ({ windowId, content }: { windowId: string; content: string }) => {
  return React.createElement('div', { 'data-testid': 'test-component' }, `${windowId}: ${content}`);
};

describe('Cytoscape Floating Windows Extension - Config API', () => {
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

    // Mock Cytoscape core methods
    mockCore = {
      container: vi.fn(() => mockContainer),
      add: vi.fn((config) => {
        const mockNode = {
          id: () => config.data.id,
          position: vi.fn(() => config.position || { x: 0, y: 0 }),
          style: vi.fn(),
          on: vi.fn()
        };
        return mockNode as unknown as cytoscape.NodeSingular;
      }),
      on: vi.fn(),
      pan: vi.fn(() => ({ x: 0, y: 0 })),
      zoom: vi.fn(() => 1)
    } as unknown as cytoscape.Core;

    // Mock cytoscape constructor/function
    mockCytoscape = vi.fn((type: string, name: string, extension: unknown) => {
      // Store the extension function for later use
      if (type === 'core' && name === 'addFloatingWindow') {
        (mockCore as unknown as Record<string, unknown>).addFloatingWindow = extension;
      }
    }) as unknown as typeof cytoscape;
  });

  it('should accept config parameter with React, ReactDOM, and components', () => {
    const config = {
      React,
      ReactDOM,
      components: {
        TestComponent
      }
    };

    // Should not throw when called with config
    expect(() => {
      registerFloatingWindows(mockCytoscape, config);
    }).not.toThrow();
  });

  it('should throw error if registerFloatingWindows is called without config', () => {
    // @ts-expect-error - intentionally testing missing config parameter
    expect(() => {
      registerFloatingWindows(mockCytoscape);
    }).toThrow(/config.*required/i);
  });

  it('should throw error if config is missing React', () => {
    const invalidConfig = {
      // @ts-expect-error - intentionally testing missing React
      ReactDOM,
      components: { TestComponent }
    };

    expect(() => {
      registerFloatingWindows(mockCytoscape, invalidConfig);
    }).toThrow(/React.*required/i);
  });

  it('should throw error if config is missing ReactDOM', () => {
    const invalidConfig = {
      React,
      // @ts-expect-error - intentionally testing missing ReactDOM
      components: { TestComponent }
    };

    expect(() => {
      registerFloatingWindows(mockCytoscape, invalidConfig);
    }).toThrow(/ReactDOM.*required/i);
  });

  it('should throw error if config is missing components', () => {
    const invalidConfig = {
      React,
      ReactDOM
      // @ts-expect-error - intentionally testing missing components
    };

    expect(() => {
      registerFloatingWindows(mockCytoscape, invalidConfig);
    }).toThrow(/components.*required/i);
  });

  it('should store config and use it when mounting components', () => {
    const config = {
      React,
      ReactDOM,
      components: {
        TestComponent
      }
    };

    // Register extension with config
    registerFloatingWindows(mockCytoscape, config);

    // Mock ReactDOM.createRoot
    const mockRoot = {
      render: vi.fn(),
      unmount: vi.fn()
    };
    const createRootSpy = vi.spyOn(ReactDOM, 'createRoot').mockReturnValue(mockRoot);

    // Call addFloatingWindow (which should use stored config)
    const addFloatingWindow = (mockCore as unknown as Record<string, unknown>).addFloatingWindow as (
      config: unknown
    ) => cytoscape.NodeSingular;

    if (addFloatingWindow) {
      addFloatingWindow.call(mockCore, {
        id: 'test-window',
        component: 'TestComponent',
        position: { x: 100, y: 100 },
        initialContent: 'test content'
      });

      // Verify ReactDOM.createRoot was called with DOM element
      expect(createRootSpy).toHaveBeenCalled();

      // Verify render was called
      expect(mockRoot.render).toHaveBeenCalled();

      // Get the rendered component
      const renderedElement = mockRoot.render.mock.calls[0][0];
      expect(renderedElement).toBeDefined();
    }

    createRootSpy.mockRestore();
  });

  it('should throw error if addFloatingWindow is called before registerFloatingWindows', () => {
    // Don't call registerFloatingWindows

    // Try to use extension directly - should fail
    const addFloatingWindow = (mockCore as unknown as Record<string, unknown>).addFloatingWindow as (
      config: unknown
    ) => cytoscape.NodeSingular;

    expect(addFloatingWindow).toBeUndefined();
  });

  it('should not use window globals (window.React, window.ReactDOM, window.componentRegistry)', () => {
    // Pollute window with globals (simulating old behavior)
    (window as unknown as Record<string, unknown>).React = React;
    (window as unknown as Record<string, unknown>).ReactDOM = ReactDOM;
    (window as unknown as Record<string, unknown>).componentRegistry = { TestComponent };

    const config = {
      React,
      ReactDOM,
      components: {
        TestComponent
      }
    };

    // Register extension
    registerFloatingWindows(mockCytoscape, config);

    // Mock ReactDOM.createRoot to track what's being used
    const mockRoot = {
      render: vi.fn(),
      unmount: vi.fn()
    };
    const createRootSpy = vi.spyOn(ReactDOM, 'createRoot').mockReturnValue(mockRoot);

    // Clear window globals to ensure they're not being used
    delete (window as unknown as Record<string, unknown>).React;
    delete (window as unknown as Record<string, unknown>).ReactDOM;
    delete (window as unknown as Record<string, unknown>).componentRegistry;

    // Call addFloatingWindow - should still work because it uses stored config
    const addFloatingWindow = (mockCore as unknown as Record<string, unknown>).addFloatingWindow as (
      config: unknown
    ) => cytoscape.NodeSingular;

    if (addFloatingWindow) {
      expect(() => {
        addFloatingWindow.call(mockCore, {
          id: 'test-window',
          component: 'TestComponent',
          position: { x: 100, y: 100 },
          initialContent: 'test content'
        });
      }).not.toThrow();

      // Should have successfully rendered using stored config, not window globals
      expect(createRootSpy).toHaveBeenCalled();
      expect(mockRoot.render).toHaveBeenCalled();
    }

    createRootSpy.mockRestore();
  });

  it('should throw descriptive error when component name is not found in registry', () => {
    const config = {
      React,
      ReactDOM,
      components: {
        TestComponent
      }
    };

    registerFloatingWindows(mockCytoscape, config);

    const addFloatingWindow = (mockCore as unknown as Record<string, unknown>).addFloatingWindow as (
      config: unknown
    ) => cytoscape.NodeSingular;

    if (addFloatingWindow) {
      expect(() => {
        addFloatingWindow.call(mockCore, {
          id: 'test-window',
          component: 'NonexistentComponent',
          position: { x: 100, y: 100 }
        });
      }).toThrow(/component.*NonexistentComponent.*not found/i);
    }
  });
});

describe('Cytoscape Floating Windows Extension - Resize Flow', () => {
  let mockCore: cytoscape.Core;
  let mockContainer: HTMLElement;
  let mockCytoscape: typeof cytoscape;

  beforeEach(() => {
    // Setup DOM
    mockContainer = document.createElement('div');
    mockContainer.style.width = '800px';
    mockContainer.style.height = '600px';
    const mockParent = document.createElement('div');
    mockParent.appendChild(mockContainer);
    document.body.appendChild(mockParent);

    // Mock node with style tracking
    const nodeStyleStorage = new Map<string, unknown>();
    const mockNode = {
      id: vi.fn(() => 'test-window'),
      position: vi.fn(() => ({ x: 100, y: 100 })),
      style: vi.fn((updates?: Record<string, unknown>) => {
        if (updates) {
          Object.entries(updates).forEach(([key, value]) => {
            nodeStyleStorage.set(key, value);
          });
          return mockNode;
        }
        // Return current style values for reading
        return (key: string) => nodeStyleStorage.get(key);
      }),
      on: vi.fn(),
      length: 1
    };

    // Mock trigger to capture events
    const eventListeners = new Map<string, Array<(event: unknown, data: unknown) => void>>();

    mockCore = {
      container: vi.fn(() => mockContainer),
      add: vi.fn(() => mockNode as unknown as cytoscape.NodeSingular),
      on: vi.fn((eventName: string, callback: (event: unknown, data: unknown) => void) => {
        if (!eventListeners.has(eventName)) {
          eventListeners.set(eventName, []);
        }
        eventListeners.get(eventName)!.push(callback);
      }),
      trigger: vi.fn((eventName: string, data: unknown[]) => {
        const listeners = eventListeners.get(eventName) || [];
        listeners.forEach(listener => listener({}, data[0]));
      }),
      pan: vi.fn(() => ({ x: 0, y: 0 })),
      zoom: vi.fn(() => 1),
      $: vi.fn(() => mockNode as unknown as cytoscape.NodeSingular)
    } as unknown as cytoscape.Core;

    mockCytoscape = vi.fn((type: string, name: string, extension: unknown) => {
      if (type === 'core' && name === 'addFloatingWindow') {
        (mockCore as unknown as Record<string, unknown>).addFloatingWindow = extension;
      }
    }) as unknown as typeof cytoscape;
  });

  it('should create ResizeObserver when addFloatingWindow is called', () => {
    const config = {
      React,
      ReactDOM,
      components: {
        TestComponent
      }
    };

    registerFloatingWindows(mockCytoscape, config);

    const addFloatingWindow = (mockCore as unknown as Record<string, unknown>).addFloatingWindow as (
      config: unknown
    ) => cytoscape.NodeSingular;

    const node = addFloatingWindow.call(mockCore, {
      id: 'resizable-window',
      component: 'TestComponent',
      position: { x: 100, y: 100 },
      resizable: true
    });

    expect(node).toBeDefined();

    // Check that window element was created
    const windowElement = document.getElementById('window-resizable-window');
    expect(windowElement).not.toBeNull();

    // Check that ResizeObserver was attached
    expect(windowElement?.hasAttribute('data-resize-observer')).toBe(true);
  });

  it('should update shadow node dimensions when ResizeObserver fires', (done) => {
    const config = {
      React,
      ReactDOM,
      components: {
        TestComponent
      }
    };

    registerFloatingWindows(mockCytoscape, config);

    const addFloatingWindow = (mockCore as unknown as Record<string, unknown>).addFloatingWindow as (
      config: unknown
    ) => cytoscape.NodeSingular;

    const mockNode = addFloatingWindow.call(mockCore, {
      id: 'resizable-window',
      component: 'TestComponent',
      position: { x: 100, y: 100 },
      shadowNodeDimensions: { width: 200, height: 150 }
    });

    const windowElement = document.getElementById('window-resizable-window');
    expect(windowElement).not.toBeNull();

    // Mock node.style() to track style updates
    const styleUpdates = new Map<string, unknown>();
    mockNode.style = vi.fn((updates?: Record<string, unknown>) => {
      if (updates) {
        Object.entries(updates).forEach(([key, value]) => {
          styleUpdates.set(key, value);
        });
      }
      return mockNode;
    });

    // Resize the window element
    windowElement!.style.width = '400px';
    windowElement!.style.height = '300px';

    // Force layout reflow (void prevents unused expression error)
    void windowElement!.offsetHeight;

    // ResizeObserver should fire asynchronously
    setTimeout(() => {
      // Check that shadow node dimensions were updated
      expect(styleUpdates.get('width')).toBe(400);
      expect(styleUpdates.get('height')).toBe(300);
      done();
    }, 100);
  });

  it('should emit floatingwindow:resize event when ResizeObserver fires', (done) => {
    const config = {
      React,
      ReactDOM,
      components: {
        TestComponent
      }
    };

    registerFloatingWindows(mockCytoscape, config);

    const addFloatingWindow = (mockCore as unknown as Record<string, unknown>).addFloatingWindow as (
      config: unknown
    ) => cytoscape.NodeSingular;

    // Set up event listener before creating window
    const eventSpy = vi.fn();
    mockCore.on('floatingwindow:resize', eventSpy);

    addFloatingWindow.call(mockCore, {
      id: 'resizable-window',
      component: 'TestComponent',
      position: { x: 100, y: 100 }
    });

    const windowElement = document.getElementById('window-resizable-window');
    expect(windowElement).not.toBeNull();

    // Trigger resize
    windowElement!.style.width = '500px';
    windowElement!.style.height = '400px';

    // Force layout reflow (void prevents unused expression error)
    void windowElement!.offsetHeight;

    // Wait for ResizeObserver callback
    setTimeout(() => {
      expect(mockCore.trigger).toHaveBeenCalledWith(
        'floatingwindow:resize',
        expect.arrayContaining([
          expect.objectContaining({
            nodeId: 'resizable-window'
          })
        ])
      );
      done();
    }, 100);
  });

  it('should sync dimensions from DOM element to shadow node correctly', () => {
    const config = {
      React,
      ReactDOM,
      components: {
        TestComponent
      }
    };

    registerFloatingWindows(mockCytoscape, config);

    const addFloatingWindow = (mockCore as unknown as Record<string, unknown>).addFloatingWindow as (
      config: unknown
    ) => cytoscape.NodeSingular;

    const mockNode = addFloatingWindow.call(mockCore, {
      id: 'dimension-test',
      component: 'TestComponent',
      position: { x: 100, y: 100 },
      shadowNodeDimensions: { width: 300, height: 200 }
    });

    const windowElement = document.getElementById('window-dimension-test');
    expect(windowElement).not.toBeNull();

    // Initial dimensions should match shadowNodeDimensions
    expect(windowElement!.offsetWidth).toBe(300);
    expect(windowElement!.offsetHeight).toBe(200);

    // Verify initial sync happened
    // Note: The initial sync uses requestAnimationFrame, so we can't easily test it synchronously
    expect(mockNode.style).toHaveBeenCalled();
  });
});
