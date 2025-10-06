/**
 * Cytoscape Floating Window Extension
 *
 * Adds floating window functionality to Cytoscape graphs.
 * Windows are anchored to invisible shadow nodes and move with graph transformations.
 */

import type cytoscape from 'cytoscape';
import type React from 'react';
import type ReactDOM from 'react-dom/client';

interface FloatingWindowConfig {
  id: string;
  component: string | React.ReactElement;
  title?: string;
  position?: { x: number; y: number };
  nodeData?: Record<string, unknown>;
  resizable?: boolean;
  initialContent?: string;
  onSave?: (content: string) => Promise<void>;
  nodeMetadata?: Record<string, unknown>;
}

export interface ExtensionConfig {
  React: typeof React;
  ReactDOM: typeof ReactDOM;
  components: Record<string, React.ComponentType<unknown>>;
}

// Store React roots for cleanup
const reactRoots = new Map<string, ReactDOM.Root>();

// Store extension configuration
let extensionConfig: ExtensionConfig | null = null;

/**
 * Get or create the shared overlay container for all floating windows
 */
function getOrCreateOverlay(cy: cytoscape.Core): HTMLElement {
  const container = cy.container() as HTMLElement;
  const parent = container.parentElement;

  if (!parent) {
    throw new Error('Cytoscape container has no parent element');
  }

  // Check if overlay already exists
  let overlay = parent.querySelector('.cy-floating-overlay') as HTMLElement;

  if (!overlay) {
    // Create new overlay as sibling to cy container
    overlay = document.createElement('div');
    overlay.className = 'cy-floating-overlay';
    overlay.style.position = 'absolute';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '1000';
    overlay.style.transformOrigin = 'top left';

    parent.appendChild(overlay);

    // Sync overlay transform with graph pan/zoom
    const syncTransform = () => {
      const pan = cy.pan();
      const zoom = cy.zoom();
      overlay.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
    };

    // Initial sync
    syncTransform();

    // Listen to graph events
    cy.on('pan zoom resize', syncTransform);
  }

  return overlay;
}

/**
 * Update window DOM element position based on node position
 */
function updateWindowPosition(node: cytoscape.NodeSingular, domElement: HTMLElement) {
  const pos = node.position();
  domElement.style.left = `${pos.x}px`;
  domElement.style.top = `${pos.y}px`;
  domElement.style.transform = 'translate(-50%, -50%)';
}

/**
 * Mount a React component or HTML string to a DOM element
 */
// Create wrapper component factory outside of mountComponent to avoid hook issues
function createWindowWrapper(
  domElement: HTMLElement,
  windowId: string,
  config: FloatingWindowConfig,
  ComponentClass: React.ComponentType<Record<string, unknown>>
) {
  if (!extensionConfig) return null;
  const { React } = extensionConfig;

  return function WindowWrapper() {
    const [isDragging, setIsDragging] = React.useState(false);
    const [dragOffset, setDragOffset] = React.useState({ x: 0, y: 0 });

    const handleMouseDown = (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).tagName === 'BUTTON') return;
      setIsDragging(true);

      // Get cytoscape instance for pan/zoom info
      const cy = (window as unknown as { lastCyInstance?: cytoscape.Core }).lastCyInstance;
      if (!cy) return;

      const pan = cy.pan();
      const zoom = cy.zoom();

      // Get current position in graph coordinates from style
      const currentLeft = parseFloat(domElement.style.left) || 0;
      const currentTop = parseFloat(domElement.style.top) || 0;

      // Convert current graph position to viewport coordinates
      const viewportX = (currentLeft * zoom) + pan.x;
      const viewportY = (currentTop * zoom) + pan.y;

      // Store offset in viewport coordinates
      setDragOffset({
        x: e.clientX - viewportX,
        y: e.clientY - viewportY
      });
      e.preventDefault();
    };

    React.useEffect(() => {
      const handleMouseMove = (e: MouseEvent) => {
        if (!isDragging) return;

        // Get cytoscape instance for pan/zoom info
        const cy = (window as unknown as { lastCyInstance?: cytoscape.Core }).lastCyInstance;
        if (!cy) return;

        const pan = cy.pan();
        const zoom = cy.zoom();

        // Calculate new viewport position
        const viewportX = e.clientX - dragOffset.x;
        const viewportY = e.clientY - dragOffset.y;

        // Convert viewport coordinates to graph coordinates
        const graphX = (viewportX - pan.x) / zoom;
        const graphY = (viewportY - pan.y) / zoom;

        domElement.style.left = `${graphX}px`;
        domElement.style.top = `${graphY}px`;
      };

      const handleMouseUp = () => {
        setIsDragging(false);
      };

      if (isDragging) {
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        return () => {
          document.removeEventListener('mousemove', handleMouseMove);
          document.removeEventListener('mouseup', handleMouseUp);
        };
      }
    }, [isDragging, dragOffset]);

    const handleClose = () => {
      // Find shadow node and remove it
      const shadowNode = domElement.getAttribute('data-shadow-node-id');
      if (shadowNode) {
        const cy = (window as unknown as { lastCyInstance?: cytoscape.Core }).lastCyInstance;
        if (cy) {
          const node = cy.$(`#${shadowNode}`);
          if (node.length > 0) {
            node.remove();
          }
        }
      }
      // Unmount React and remove DOM
      const root = reactRoots.get(windowId);
      if (root) {
        root.unmount();
        reactRoots.delete(windowId);
      }
      domElement.remove();
    };

    return React.createElement('div', {
      className: 'cy-floating-window-wrapper'
    }, [
      // Title bar
      React.createElement('div', {
        key: 'titlebar',
        className: `cy-floating-window-title ${isDragging ? 'dragging' : ''}`,
        onMouseDown: handleMouseDown
      }, [
        React.createElement('span', {
          key: 'title',
          className: 'cy-floating-window-title-text'
        }, config.title || `Window: ${windowId}`),
        React.createElement('button', {
          key: 'close',
          className: 'cy-floating-window-close',
          onClick: handleClose
        }, '×')
      ]),
      // Content
      React.createElement('div', {
        key: 'content',
        className: 'cy-floating-window-content'
      }, React.createElement(ComponentClass, {
        windowId: windowId,
        content: config.initialContent || '',
        nodeMetadata: config.nodeMetadata,
        onSave: config.onSave || ((content: string) => {
          console.log('Saved content:', content);
          return Promise.resolve();
        })
      }))
    ]);
  };
}

function mountComponent(
  domElement: HTMLElement,
  component: string | React.ReactElement,
  windowId: string,
  config: FloatingWindowConfig
) {
  console.log('[FloatingWindows] mountComponent called for:', windowId, 'component:', component);

  if (!extensionConfig) {
    console.error('[FloatingWindows] Extension not properly initialized. Call registerFloatingWindows with config first.');
    domElement.innerHTML = '<div style="padding: 10px; color: red;">Error: Extension not initialized</div>';
    return;
  }

  const { React, ReactDOM, components } = extensionConfig;
  console.log('[FloatingWindows] Available components:', Object.keys(components));

  // Check if component is a registered component name
  if (typeof component === 'string') {
    if (!components[component]) {
      throw new Error(`[FloatingWindows] Component '${component}' not found in component registry. Available components: ${Object.keys(components).join(', ')}`);
    }

    const ComponentClass = components[component];
    console.log('[FloatingWindows] Creating root for component:', component);
    console.log('[FloatingWindows] DOM element in document?', document.body.contains(domElement));
    console.log('[FloatingWindows] DOM element id:', domElement.id);

    if (!document.body.contains(domElement)) {
      console.error('[FloatingWindows] ERROR: DOM element must be in document before mounting React!');
      return;
    }

    try {
      const root = ReactDOM.createRoot(domElement);

      // Create wrapper component using the factory
      const WrapperComponent = createWindowWrapper(domElement, windowId, config, ComponentClass);

      if (!WrapperComponent) {
        console.error('[FloatingWindows] Failed to create wrapper component');
        return;
      }

      console.log('[FloatingWindows] Rendering wrapper component to DOM');

      // Render the wrapper component
      root.render(React.createElement(WrapperComponent));
      reactRoots.set(windowId, root);
      console.log('[FloatingWindows] Component mounted successfully');
    } catch (error) {
      console.error('[FloatingWindows] Error mounting component:', error);
      domElement.innerHTML = `<div style="padding: 10px; color: red;">Error mounting component: ${error}</div>`;
    }
  } else {
    // React element
    const root = ReactDOM.createRoot(domElement);
    root.render(component);
    reactRoots.set(windowId, root);
  }
}

/**
 * Register the floating windows extension with Cytoscape
 */
export function registerFloatingWindows(
  cytoscape: typeof import('cytoscape'),
  config: ExtensionConfig
) {
  console.log('[FloatingWindows] Registering extension...');

  // Validate config
  if (!config) {
    throw new Error('[FloatingWindows] Config is required. Must provide React, ReactDOM, and components.');
  }

  if (!config.React) {
    throw new Error('[FloatingWindows] Config.React is required.');
  }

  if (!config.ReactDOM) {
    throw new Error('[FloatingWindows] Config.ReactDOM is required.');
  }

  if (!config.components) {
    throw new Error('[FloatingWindows] Config.components is required.');
  }

  // Store config
  extensionConfig = config;
  console.log('[FloatingWindows] Extension configured with React dependencies');

  // Add the addFloatingWindow method to Core prototype
  cytoscape('core', 'addFloatingWindow', function(this: cytoscape.Core, config: FloatingWindowConfig) {
    console.log('[FloatingWindows] addFloatingWindow called with config:', config);
    const { id, component, position = { x: 0, y: 0 }, nodeData = {}, resizable = false } = config;

    // Validate extension is initialized
    if (!extensionConfig) {
      throw new Error('Extension not initialized! Call registerFloatingWindows first.');
    }

    // Validate component exists early (fail-fast principle)
    if (typeof component === 'string') {
      const { components } = extensionConfig;
      if (!components[component]) {
        throw new Error(`Component "${component}" not found in registry. Available components: ${Object.keys(components).join(', ')}`);
      }
    }

    // 1. Get or create overlay
    const overlay = getOrCreateOverlay(this);

    // 2. Create shadow node
    const shadowNode = this.add({
      group: 'nodes',
      data: { id, ...nodeData },
      position
    });

    // 3. Style shadow node (invisible but interactive)
    shadowNode.style({
      'opacity': 0,
      'events': 'yes',
      'width': 1,
      'height': 1
    });

    // 4. Create DOM element for window
    const windowElement = document.createElement('div');
    windowElement.id = `window-${id}`;
    windowElement.className = 'cy-floating-window';
    windowElement.setAttribute('data-shadow-node-id', id);

    // Store cy instance for close button
    (window as unknown as { lastCyInstance: cytoscape.Core }).lastCyInstance = this;

    // Event isolation - prevent graph interactions
    windowElement.addEventListener('mousedown', (e) => {
      e.stopPropagation();
    });
    windowElement.addEventListener('wheel', (e) => {
      e.stopPropagation();
    }, { passive: false });


    // Add resizable capability if requested
    if (resizable) {
      windowElement.classList.add('resizable');
    }

    // 5. Add window to overlay FIRST (must be in DOM before React mount)
    overlay.appendChild(windowElement);

    // 6. Mount component to window element (after it's in the DOM)
    mountComponent(windowElement, component, id, config);

    // 7. Initial position sync
    updateWindowPosition(shadowNode, windowElement);

    // 8. Listen to node position changes
    shadowNode.on('position', () => {
      updateWindowPosition(shadowNode, windowElement);
    });

    // Return the shadow node for further manipulation
    return shadowNode;
  });
}

// Type augmentation for TypeScript
declare module 'cytoscape' {
  interface Core {
    addFloatingWindow(config: FloatingWindowConfig): cytoscape.NodeSingular;
  }
}
