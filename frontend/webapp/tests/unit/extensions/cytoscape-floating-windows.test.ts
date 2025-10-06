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
