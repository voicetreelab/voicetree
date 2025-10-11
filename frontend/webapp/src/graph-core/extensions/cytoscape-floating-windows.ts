/**
 * Cytoscape Floating Window Extension
 *
 * Adds floating window functionality to Cytoscape graphs.
 * Windows are anchored to invisible shadow nodes and move with graph transformations.
 */

import type cytoscape from 'cytoscape';
import type React from 'react';
import type ReactDOM from 'react-dom/client';

export interface FloatingWindowConfig {
  id: string;
  component: string | React.ReactElement;
  title: string;
  position?: { x: number; y: number };
  nodeData?: Record<string, unknown>;
  resizable?: boolean;
  initialContent?: string;
  onSave?: (content: string) => Promise<void>;
  nodeMetadata?: Record<string, unknown>;
  previewMode?: 'edit' | 'live' | 'preview';
  // Shadow node dimensions for layout algorithm (defaults based on component type)
  shadowNodeDimensions?: { width: number; height: number };
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
 * Update shadow node dimensions based on window DOM element dimensions
 * Dimensions flow: DOM element (source of truth) → shadow node (for layout)
 */
function updateShadowNodeDimensions(shadowNode: cytoscape.NodeSingular, domElement: HTMLElement) {
  // Use offsetWidth/Height to get full rendered size including borders
  const width = domElement.offsetWidth;
  const height = domElement.offsetHeight;

  // Update shadow node dimensions for layout algorithm
  shadowNode.style({
    'width': width,
    'height': height
  });
}

/**
 * Create the window chrome (frame) synchronously with vanilla DOM
 * This includes: window container, title bar, close button, and content container
 * Returns the main window element and the content container for React mounting
 */
function createWindowChrome(
  cy: cytoscape.Core,
  config: FloatingWindowConfig,
  shadowNode: cytoscape.NodeSingular
): { windowElement: HTMLElement; contentContainer: HTMLElement } {
  const { id, title, resizable = false, component } = config;

  // Get initial dimensions for this component type
  const dimensions = config.shadowNodeDimensions || getDefaultDimensions(component);

  // Create main window container
  const windowElement = document.createElement('div');
  windowElement.id = `window-${id}`;
  windowElement.className = 'cy-floating-window';
  windowElement.setAttribute('data-shadow-node-id', id);

  // Set initial dimensions
  windowElement.style.width = `${dimensions.width}px`;
  windowElement.style.height = `${dimensions.height}px`;

  if (resizable) {
    windowElement.classList.add('resizable');
  }

  // Event isolation - prevent graph interactions
  windowElement.addEventListener('mousedown', (e) => {
    e.stopPropagation();
  });
  windowElement.addEventListener('wheel', (e) => {
    e.stopPropagation();
  }, { passive: false });

  // Create title bar
  const titleBar = document.createElement('div');
  titleBar.className = 'cy-floating-window-title';

  // Create title text
  const titleText = document.createElement('span');
  titleText.className = 'cy-floating-window-title-text';
  titleText.textContent = title || `Window: ${id}`;

  // Create close button
  const closeButton = document.createElement('button');
  closeButton.className = 'cy-floating-window-close';
  closeButton.textContent = '×';

  // Attach close handler
  closeButton.addEventListener('click', () => {
    // Find and remove shadow node
    const shadowNode = cy.$(`#${id}`);
    if (shadowNode.length > 0) {
      shadowNode.remove();
    }
    // Unmount React and remove DOM
    const root = reactRoots.get(id);
    if (root) {
      root.unmount();
      reactRoots.delete(id);
    }
    windowElement.remove();
  });

  // Assemble title bar
  titleBar.appendChild(titleText);
  titleBar.appendChild(closeButton);

  // Create content container
  const contentContainer = document.createElement('div');
  contentContainer.className = 'cy-floating-window-content';

  // Assemble window
  windowElement.appendChild(titleBar);
  windowElement.appendChild(contentContainer);

  // Attach drag handlers to title bar
  attachDragHandlers(cy, titleBar, windowElement);

  // Set up ResizeObserver to sync window size to shadow node
  // This ensures layout algorithm knows the real window dimensions
  if (typeof ResizeObserver !== 'undefined') {
    const resizeObserver = new ResizeObserver(() => {
      // Sync dimensions from DOM element to shadow node
      updateShadowNodeDimensions(shadowNode, windowElement);

      // Emit custom event for layout manager to listen to
      cy.trigger('floatingwindow:resize', { nodeId: shadowNode.id() });
    });

    resizeObserver.observe(windowElement);

    // Store observer for cleanup
    windowElement.setAttribute('data-resize-observer', 'attached');
  }

  return { windowElement, contentContainer };
}

/**
 * Attach drag-and-drop handlers to the title bar (vanilla JS)
 */
function attachDragHandlers(
  cy: cytoscape.Core,
  titleBar: HTMLElement,
  windowElement: HTMLElement
) {
  let isDragging = false;
  let dragOffset = { x: 0, y: 0 };

  const handleMouseDown = (e: MouseEvent) => {
    // Don't start drag if clicking on buttons
    if ((e.target as HTMLElement).tagName === 'BUTTON') return;

    isDragging = true;
    titleBar.classList.add('dragging');

    const pan = cy.pan();
    const zoom = cy.zoom();

    // Get current position in graph coordinates from style
    const currentLeft = parseFloat(windowElement.style.left) || 0;
    const currentTop = parseFloat(windowElement.style.top) || 0;

    // Convert current graph position to viewport coordinates
    const viewportX = (currentLeft * zoom) + pan.x;
    const viewportY = (currentTop * zoom) + pan.y;

    // Store offset in viewport coordinates
    dragOffset = {
      x: e.clientX - viewportX,
      y: e.clientY - viewportY
    };

    e.preventDefault();
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging) return;

    const pan = cy.pan();
    const zoom = cy.zoom();

    // Calculate new viewport position
    const viewportX = e.clientX - dragOffset.x;
    const viewportY = e.clientY - dragOffset.y;

    // Convert viewport coordinates to graph coordinates
    const graphX = (viewportX - pan.x) / zoom;
    const graphY = (viewportY - pan.y) / zoom;

    windowElement.style.left = `${graphX}px`;
    windowElement.style.top = `${graphY}px`;

    // Update shadow node position so edge follows
    const shadowNodeId = windowElement.getAttribute('data-shadow-node-id');
    if (shadowNodeId) {
      const shadowNode = cy.$(`#${shadowNodeId}`);
      if (shadowNode.length > 0) {
        shadowNode.position({ x: graphX, y: graphY });
      }
    }
  };

  const handleMouseUp = () => {
    if (isDragging) {
      isDragging = false;
      titleBar.classList.remove('dragging');
    }
  };

  // Attach listeners
  titleBar.addEventListener('mousedown', handleMouseDown);
  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseup', handleMouseUp);
}

/**
 * Mount React content component to the content container
 * Simplified to only handle content rendering - no wrapper, no title bar
 */
function mountComponent(
  contentContainer: HTMLElement,
  component: string | React.ReactElement,
  windowId: string,
  config: FloatingWindowConfig
) {
  console.log('[FloatingWindows] mountComponent called for:', windowId, 'component:', component);

  if (!extensionConfig) {
    console.error('[FloatingWindows] Extension not properly initialized.');
    contentContainer.innerHTML = '<div style="padding: 10px; color: red;">Error: Extension not initialized</div>';
    return;
  }

  const { React, ReactDOM, components } = extensionConfig;

  // Check if component is a registered component name
  if (typeof component === 'string') {
    if (!components[component]) {
      throw new Error(`[FloatingWindows] Component '${component}' not found in component registry. Available: ${Object.keys(components).join(', ')}`);
    }

    const ComponentClass = components[component];
    console.log('[FloatingWindows] Creating root for component:', component);

    if (!document.body.contains(contentContainer)) {
      console.error('[FloatingWindows] ERROR: Content container must be in document before mounting React!');
      return;
    }

    try {
      const root = ReactDOM.createRoot(contentContainer);

      // Render the component directly - no wrapper
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      root.render(React.createElement(ComponentClass as any, {
        windowId: windowId,
        content: config.initialContent || '',
        nodeMetadata: config.nodeMetadata,
        previewMode: config.previewMode,
        onSave: config.onSave || ((content: string) => {
          console.log('Saved content:', content);
          return Promise.resolve();
        })
      }));

      reactRoots.set(windowId, root);
      console.log('[FloatingWindows] Component mounted successfully');
    } catch (error) {
      console.error('[FloatingWindows] Error mounting component:', error);
      contentContainer.innerHTML = `<div style="padding: 10px; color: red;">Error mounting component: ${error}</div>`;
    }
  } else {
    // React element
    const root = ReactDOM.createRoot(contentContainer);
    root.render(component);
    reactRoots.set(windowId, root);
  }
}

/**
 * Get default shadow node dimensions based on component type
 * Terminals are larger, editors are medium, other components are small
 */
function getDefaultDimensions(component: string | React.ReactElement): { width: number; height: number } {
  if (typeof component === 'string') {
    switch (component) {
      case 'Terminal':
        // Terminals are visually large - typical size ~600x400
        return { width: 600, height: 400 };
      case 'MarkdownEditor':
        // Editors are medium - typical size ~500x300
        return { width: 500, height: 300 };
      default:
        // Default for unknown components
        return { width: 200, height: 150 };
    }
  }
  // React elements get default size
  return { width: 200, height: 150 };
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
    const { id, component, position = { x: 0, y: 0 }, nodeData = {} } = config;

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

    // 2. Create shadow node (invisible anchor in graph space)
    // Ensure parentId is set if parentNodeId exists (for layout algorithm compatibility)
    const shadowNodeData: Record<string, unknown> = { id, ...nodeData };
    if (nodeData.parentNodeId && !shadowNodeData.parentId) {
      shadowNodeData.parentId = nodeData.parentNodeId;
    }

    const shadowNode = this.add({
      group: 'nodes',
      data: shadowNodeData,
      position
    });

    // 3. Style shadow node (invisible but interactive)
    // Set dimensions for layout algorithm - defaults based on component type
    const dimensions = config.shadowNodeDimensions || getDefaultDimensions(component);
    shadowNode.style({
      'opacity': 0,
      'events': 'yes',
      'width': dimensions.width,
      'height': dimensions.height
    });

    // 4. Create edge from parent node to shadow node if parentNodeId exists
    if (nodeData.parentNodeId) {
      this.add({
        group: 'edges',
        data: {
          id: `edge-${nodeData.parentNodeId}-${id}`,
          source: nodeData.parentNodeId,
          target: id
        }
      });
    }

    // 5. Create window chrome SYNCHRONOUSLY with vanilla DOM
    // This is the key fix - chrome exists immediately in DOM
    const { windowElement, contentContainer } = createWindowChrome(this, config, shadowNode);

    // 6. Add window to overlay (must be in DOM before React mount)
    overlay.appendChild(windowElement);

    // 7. Initial position sync
    updateWindowPosition(shadowNode, windowElement);

    // 8. Listen to node position changes
    shadowNode.on('position', () => {
      updateWindowPosition(shadowNode, windowElement);
    });

    // 9. Initial dimension sync (DOM element is source of truth)
    // Use requestAnimationFrame to ensure browser has calculated layout first
    requestAnimationFrame(() => {
      updateShadowNodeDimensions(shadowNode, windowElement);
    });

    // 10. Mount React component ASYNCHRONOUSLY to content container
    // This happens after the chrome is already in the DOM and testable
    mountComponent(contentContainer, component, id, config);

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
