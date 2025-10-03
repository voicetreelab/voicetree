/**
 * Cytoscape Floating Window Extension
 *
 * Adds floating window functionality to Cytoscape graphs.
 * Windows are anchored to invisible shadow nodes and move with graph transformations.
 */

import type cytoscape from 'cytoscape';

interface FloatingWindowConfig {
  id: string;
  component: string | React.ReactElement;
  position?: { x: number; y: number };
  nodeData?: Record<string, unknown>;
  resizable?: boolean;
  initialContent?: string;
}

// Store React roots for cleanup
const reactRoots = new Map<string, any>();

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
function mountComponent(
  domElement: HTMLElement,
  component: string | React.ReactElement,
  windowId: string,
  config: FloatingWindowConfig
) {
  // Check if component is a registered component name
  if (typeof component === 'string' && (window as any).componentRegistry?.[component]) {
    const ComponentClass = (window as any).componentRegistry[component];
    const root = (window as any).ReactDOM.createRoot(domElement);

    // Create component instance with props
    const componentElement = (window as any).React.createElement(ComponentClass, {
      windowId: windowId,
      content: config.initialContent || '',
      onSave: (content: string) => {
        console.log('Saved content:', content);
        return Promise.resolve();
      }
    });

    root.render(componentElement);
    reactRoots.set(windowId, root);
  } else if (typeof component === 'string') {
    // HTML string - use eval to execute React.createElement if present
    if (component.includes('React.createElement')) {
      try {
        // Safely eval the React component code
        const componentElement = eval(component);
        const root = (window as any).ReactDOM.createRoot(domElement);
        root.render(componentElement);
        reactRoots.set(windowId, root);
      } catch (e) {
        console.error('Failed to eval React component:', e);
        domElement.innerHTML = component;
      }
    } else {
      // Plain HTML
      domElement.innerHTML = component;
    }
  } else {
    // React element
    const root = (window as any).ReactDOM.createRoot(domElement);
    root.render(component);
    reactRoots.set(windowId, root);
  }
}

/**
 * Register the floating windows extension with Cytoscape
 */
export function registerFloatingWindows(cytoscape: typeof import('cytoscape')) {
  console.log('[FloatingWindows] Registering extension...');
  // Add the addFloatingWindow method to Core prototype
  cytoscape('core', 'addFloatingWindow', function(this: cytoscape.Core, config: FloatingWindowConfig) {
    console.log('[FloatingWindows] addFloatingWindow called with config:', config);
    const cy = this;
    const { id, component, position = { x: 0, y: 0 }, nodeData = {}, resizable = false } = config;

    // 1. Get or create overlay
    const overlay = getOrCreateOverlay(cy);

    // 2. Create shadow node
    const shadowNode = cy.add({
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
    windowElement.style.position = 'absolute';
    windowElement.style.pointerEvents = 'auto';
    windowElement.style.minWidth = '300px';
    windowElement.style.minHeight = '200px';
    windowElement.style.background = 'white';
    windowElement.style.border = '1px solid #ccc';
    windowElement.style.borderRadius = '4px';
    windowElement.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';

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
      windowElement.style.resize = 'both';
      windowElement.style.overflow = 'auto';
    }

    // 5. Mount component to window element
    mountComponent(windowElement, component, id, config);

    // 6. Add window to overlay
    overlay.appendChild(windowElement);

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
