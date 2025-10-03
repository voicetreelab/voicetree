// tests/e2e/isolated-with-harness/graph-core/floating-window-extension.spec.ts

import { test, expect } from '@playwright/test';

test.describe('Cytoscape Floating Window Extension - Phase 1', () => {

  test('should add floating window that moves with graph transformations', async ({ page }) => {
    // Navigate to the new shared test harness
    await page.goto('/tests/e2e/isolated-with-harness/graph-core/cytoscape-react-harness.html');
    await page.waitForSelector('[data-harness-ready="true"]');

    // Inject the extension code
    await page.evaluate(() => {
      // Store React roots for cleanup
      const reactRoots = new Map<string, any>();

      function getOrCreateOverlay(cy: any): HTMLElement {
        const container = cy.container() as HTMLElement;
        const parent = container.parentElement;

        if (!parent) {
          throw new Error('Cytoscape container has no parent element');
        }

        let overlay = parent.querySelector('.cy-floating-overlay') as HTMLElement;

        if (!overlay) {
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

          const syncTransform = () => {
            const pan = cy.pan();
            const zoom = cy.zoom();
            overlay.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
          };

          syncTransform();
          cy.on('pan zoom resize', syncTransform);
        }

        return overlay;
      }

      function updateWindowPosition(node: any, domElement: HTMLElement) {
        const pos = node.position();
        domElement.style.left = `${pos.x}px`;
        domElement.style.top = `${pos.y}px`;
        domElement.style.transform = 'translate(-50%, -50%)';
      }

      function mountComponent(domElement: HTMLElement, component: string, windowId: string) {
        if (typeof component === 'string') {
          if (component.includes('React.createElement')) {
            try {
              const componentElement = eval(component);
              const root = (window as any).ReactDOM.createRoot(domElement);
              root.render(componentElement);
              reactRoots.set(windowId, root);
            } catch (e) {
              console.error('Failed to eval React component:', e);
              domElement.innerHTML = component;
            }
          } else {
            domElement.innerHTML = component;
          }
        } else {
          const root = (window as any).ReactDOM.createRoot(domElement);
          root.render(component);
          reactRoots.set(windowId, root);
        }
      }

      // Register extension
      (window as any).cytoscape('core', 'addFloatingWindow', function(this: any, config: any) {
        const { id, component, position = { x: 0, y: 0 }, nodeData = {} } = config;

        const overlay = getOrCreateOverlay(cy);

        const shadowNode = cy.add({
          group: 'nodes',
          data: { id, ...nodeData },
          position
        });

        shadowNode.style({
          'opacity': 0,
          'events': 'yes',
          'width': 1,
          'height': 1
        });

        const windowElement = document.createElement('div');
        windowElement.id = `window-${id}`;
        windowElement.className = 'cy-floating-window';
        windowElement.style.position = 'absolute';
        windowElement.style.pointerEvents = 'auto';

        mountComponent(windowElement, component, id);
        overlay.appendChild(windowElement);
        updateWindowPosition(shadowNode, windowElement);

        shadowNode.on('position', () => {
          updateWindowPosition(shadowNode, windowElement);
        });

        return shadowNode;
      });

      window.extensionLoaded = true;
    });

    // Initialize cytoscape with extension
    const setup = await page.evaluate(() => {
      const cy = window.cy;
      cy.add([
        { data: { id: 'node1' }, position: { x: 200, y: 200 } },
        { data: { id: 'node2' }, position: { x: 400, y: 300 } }
      ]);

      // Add floating window
      const TestComponent = `React.createElement('div', {
        className: 'test-window',
        style: {
          width: '200px',
          height: '100px',
          background: 'white',
          border: '2px solid #4b96ff',
          borderRadius: '8px',
          padding: '10px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
        }
      }, 'Test Window')`;

      // This is what we're testing exists:
      const windowNode = cy.addFloatingWindow({
        id: 'test-window-1',
        component: TestComponent,
        position: { x: 200, y: 200 }
      });

      window.windowNode = windowNode;

      return {
        nodeExists: windowNode.length > 0,
        nodeId: windowNode.id(),
        nodePosition: windowNode.position()
      };
    });

    // ✅ Test 1: Verify shadow node was created
    expect(setup.nodeExists).toBe(true);
    expect(setup.nodeId).toBe('test-window-1');
    expect(setup.nodePosition).toEqual({ x: 200, y: 200 });

    // ✅ Test 2: Verify DOM overlay container exists
    const overlayExists = await page.evaluate(() => {
      const container = document.getElementById('cy');
      const overlay = container.parentElement.querySelector('.cy-floating-overlay');
      return overlay !== null;
    });
    expect(overlayExists).toBe(true);

    // ✅ Test 3: Verify window DOM element exists in overlay
    const windowElementExists = await page.evaluate(() => {
      const overlay = document.querySelector('.cy-floating-overlay');
      const windowElement = overlay.querySelector('#window-test-window-1');
      return windowElement !== null;
    });
    expect(windowElementExists).toBe(true);

    // ✅ Test 4: Verify React component rendered
    const componentRendered = await page.evaluate(() => {
      const windowElement = document.querySelector('#window-test-window-1');
      return windowElement.querySelector('.test-window') !== null;
    });
    expect(componentRendered).toBe(true);

    // ✅ Test 5: Get initial positions for comparison
    const initialState = await page.evaluate(() => {
      const cy = window.cy;
      const overlay = document.querySelector('.cy-floating-overlay');
      const windowElement = document.querySelector('#window-test-window-1');

      return {
        overlayTransform: overlay.style.transform,
        windowLeft: windowElement.style.left,
        windowTop: windowElement.style.top,
        nodePosition: cy.getElementById('test-window-1').position(),
        pan: cy.pan(),
        zoom: cy.zoom()
      };
    });

    expect(initialState.windowLeft).toBe('200px');
    expect(initialState.windowTop).toBe('200px');
    expect(initialState.overlayTransform).toBe('translate(0px, 0px) scale(1)');

    // ✅ Test 6: Pan the graph - window should stay fixed in graph space
    await page.evaluate(() => {
      window.cy.pan({ x: 100, y: 50 });
    });

    const afterPan = await page.evaluate(() => {
      const overlay = document.querySelector('.cy-floating-overlay');
      const windowElement = document.querySelector('#window-test-window-1');

      return {
        overlayTransform: overlay.style.transform,
        windowLeft: windowElement.style.left,
        windowTop: windowElement.style.top,
        pan: window.cy.pan()
      };
    });

    // Overlay transform should reflect pan
    expect(afterPan.overlayTransform).toBe('translate(100px, 50px) scale(1)');
    // Window position in DOM should NOT change (fixed in graph space)
    expect(afterPan.windowLeft).toBe('200px');
    expect(afterPan.windowTop).toBe('200px');

    // ✅ Test 7: Zoom the graph - window should scale
    await page.evaluate(() => {
      window.cy.zoom(2);
    });

    const afterZoom = await page.evaluate(() => {
      const overlay = document.querySelector('.cy-floating-overlay');
      return {
        overlayTransform: overlay.style.transform,
        zoom: window.cy.zoom()
      };
    });

    expect(afterZoom.zoom).toBe(2);
    expect(afterZoom.overlayTransform).toBe('translate(100px, 50px) scale(2)');

    // ✅ Test 8: Move the node programmatically - window should follow
    await page.evaluate(() => {
      const node = window.cy.getElementById('test-window-1');
      node.position({ x: 300, y: 400 });
    });

    const afterNodeMove = await page.evaluate(() => {
      const windowElement = document.querySelector('#window-test-window-1');
      const node = window.cy.getElementById('test-window-1');

      return {
        windowLeft: windowElement.style.left,
        windowTop: windowElement.style.top,
        nodePosition: node.position()
      };
    });

    expect(afterNodeMove.nodePosition).toEqual({ x: 300, y: 400 });
    expect(afterNodeMove.windowLeft).toBe('300px');
    expect(afterNodeMove.windowTop).toBe('400px');

    // ✅ Test 9: Add edge to shadow node - should work like regular node
    const edgeAdded = await page.evaluate(() => {
      const cy = window.cy;
      cy.add({
        group: 'edges',
        data: {
          id: 'edge1',
          source: 'node1',
          target: 'test-window-1'
        }
      });

      const edge = cy.getElementById('edge1');
      return {
        exists: edge.length > 0,
        source: edge.source().id(),
        target: edge.target().id()
      };
    });

    expect(edgeAdded.exists).toBe(true);
    expect(edgeAdded.source).toBe('node1');
    expect(edgeAdded.target).toBe('test-window-1');

    // ✅ Test 10: Visual regression - take screenshots
    await page.screenshot({
      path: 'tests/screenshots/floating-window-with-edge.png',
      clip: { x: 0, y: 0, width: 800, height: 600 }
    });

    // Reset pan/zoom and take another screenshot
    await page.evaluate(() => {
      window.cy.reset();
    });

    await page.screenshot({
      path: 'tests/screenshots/floating-window-reset.png',
      clip: { x: 0, y: 0, width: 800, height: 600 }
    });
  });

  test('should handle multiple floating windows', async ({ page }) => {
    await page.goto('/tests/e2e/isolated-with-harness/graph-core/cytoscape-react-harness.html');
    await page.waitForSelector('[data-harness-ready="true"]');

    // Inject the extension code
    await page.evaluate(() => {
      const reactRoots = new Map<string, any>();

      function getOrCreateOverlay(cy: any): HTMLElement {
        const container = cy.container() as HTMLElement;
        const parent = container.parentElement;
        if (!parent) throw new Error('Cytoscape container has no parent element');
        let overlay = parent.querySelector('.cy-floating-overlay') as HTMLElement;
        if (!overlay) {
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
          const syncTransform = () => {
            const pan = cy.pan();
            const zoom = cy.zoom();
            overlay.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
          };
          syncTransform();
          cy.on('pan zoom resize', syncTransform);
        }
        return overlay;
      }

      function updateWindowPosition(node: any, domElement: HTMLElement) {
        const pos = node.position();
        domElement.style.left = `${pos.x}px`;
        domElement.style.top = `${pos.y}px`;
        domElement.style.transform = 'translate(-50%, -50%)';
      }

      function mountComponent(domElement: HTMLElement, component: string, windowId: string) {
        if (typeof component === 'string') {
          if (component.includes('React.createElement')) {
            try {
              const componentElement = eval(component);
              const root = (window as any).ReactDOM.createRoot(domElement);
              root.render(componentElement);
              reactRoots.set(windowId, root);
            } catch (e) {
              console.error('Failed to eval React component:', e);
              domElement.innerHTML = component;
            }
          } else {
            domElement.innerHTML = component;
          }
        }
      }

      (window as any).cytoscape('core', 'addFloatingWindow', function(config: any) {
        const cy = this;
        const { id, component, position = { x: 0, y: 0 }, nodeData = {} } = config;
        const overlay = getOrCreateOverlay(cy);
        const shadowNode = cy.add({ group: 'nodes', data: { id, ...nodeData }, position });
        shadowNode.style({ 'opacity': 0, 'events': 'yes', 'width': 1, 'height': 1 });
        const windowElement = document.createElement('div');
        windowElement.id = `window-${id}`;
        windowElement.className = 'cy-floating-window';
        windowElement.style.position = 'absolute';
        windowElement.style.pointerEvents = 'auto';
        mountComponent(windowElement, component, id);
        overlay.appendChild(windowElement);
        updateWindowPosition(shadowNode, windowElement);
        shadowNode.on('position', () => { updateWindowPosition(shadowNode, windowElement); });
        return shadowNode;
      });
    });

    const multiWindowTest = await page.evaluate(() => {
      const cy = window.cy;

      // Add two windows (they create their own shadow nodes)
      const window1 = cy.addFloatingWindow({
        id: 'window1',
        component: '<div>Window 1</div>',
        position: { x: 200, y: 200 }
      });

      const window2 = cy.addFloatingWindow({
        id: 'window2',
        component: '<div>Window 2</div>',
        position: { x: 500, y: 200 }
      });

      return {
        window1Exists: window1.length > 0,
        window2Exists: window2.length > 0,
        totalNodes: cy.nodes().length
      };
    });

    // Should have 2 shadow nodes (one for each window)
    expect(multiWindowTest.totalNodes).toBe(2);
    expect(multiWindowTest.window1Exists).toBe(true);
    expect(multiWindowTest.window2Exists).toBe(true);

    // Should only have ONE overlay (shared)
    const overlayCount = await page.evaluate(() => {
      return document.querySelectorAll('.cy-floating-overlay').length;
    });
    expect(overlayCount).toBe(1);

    // Both windows should be in the same overlay
    const windowsInOverlay = await page.evaluate(() => {
      const overlay = document.querySelector('.cy-floating-overlay');
      return overlay.children.length;
    });
    expect(windowsInOverlay).toBe(2);

    // Pan should affect both windows
    await page.evaluate(() => {
      window.cy.pan({ x: 50, y: 50 });
    });

    const overlayTransform = await page.evaluate(() => {
      return document.querySelector('.cy-floating-overlay').style.transform;
    });

    expect(overlayTransform).toBe('translate(50px, 50px) scale(1)');
  });
});

test.describe('Cytoscape Floating Window Extension - Phase 2 (Resizing)', () => {

  test('should allow resizing floating windows with resize handles', async ({ page }) => {
    await page.goto('/tests/e2e/isolated-with-harness/graph-core/cytoscape-react-harness.html');
    await page.waitForSelector('[data-harness-ready="true"]');

    // Inject the extension code (same as Phase 1, but now with resizing support)
    await page.evaluate(() => {
      const reactRoots = new Map<string, any>();

      function getOrCreateOverlay(cy: any): HTMLElement {
        const container = cy.container() as HTMLElement;
        const parent = container.parentElement;
        if (!parent) throw new Error('Cytoscape container has no parent element');
        let overlay = parent.querySelector('.cy-floating-overlay') as HTMLElement;
        if (!overlay) {
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
          const syncTransform = () => {
            const pan = cy.pan();
            const zoom = cy.zoom();
            overlay.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
          };
          syncTransform();
          cy.on('pan zoom resize', syncTransform);
        }
        return overlay;
      }

      function updateWindowPosition(node: any, domElement: HTMLElement) {
        const pos = node.position();
        domElement.style.left = `${pos.x}px`;
        domElement.style.top = `${pos.y}px`;
        domElement.style.transform = 'translate(-50%, -50%)';
      }

      function mountComponent(domElement: HTMLElement, component: string, windowId: string) {
        if (typeof component === 'string') {
          if (component.includes('React.createElement')) {
            try {
              const componentElement = eval(component);
              const root = (window as any).ReactDOM.createRoot(domElement);
              root.render(componentElement);
              reactRoots.set(windowId, root);
            } catch (e) {
              console.error('Failed to eval React component:', e);
              domElement.innerHTML = component;
            }
          } else {
            domElement.innerHTML = component;
          }
        }
      }

      (window as any).cytoscape('core', 'addFloatingWindow', function(config: any) {
        const cy = this;
        const { id, component, position = { x: 0, y: 0 }, nodeData = {}, resizable = false } = config;
        const overlay = getOrCreateOverlay(cy);
        const shadowNode = cy.add({ group: 'nodes', data: { id, ...nodeData }, position });
        shadowNode.style({ 'opacity': 0, 'events': 'yes', 'width': 1, 'height': 1 });

        const windowElement = document.createElement('div');
        windowElement.id = `window-${id}`;
        windowElement.className = 'cy-floating-window';
        windowElement.style.position = 'absolute';
        windowElement.style.pointerEvents = 'auto';
        windowElement.style.minWidth = '100px';
        windowElement.style.minHeight = '100px';

        // Add resizable capability if requested
        if (resizable) {
          windowElement.classList.add('resizable');
          windowElement.style.resize = 'both';
          windowElement.style.overflow = 'auto';
        }

        mountComponent(windowElement, component, id);
        overlay.appendChild(windowElement);
        updateWindowPosition(shadowNode, windowElement);
        shadowNode.on('position', () => { updateWindowPosition(shadowNode, windowElement); });
        return shadowNode;
      });
    });

    // Create a resizable floating window
    const setup = await page.evaluate(() => {
      const cy = window.cy;
      cy.add([
        { data: { id: 'node1' }, position: { x: 200, y: 200 } }
      ]);

      const TestComponent = `React.createElement('div', {
        className: 'test-window',
        style: {
          width: '200px',
          height: '150px',
          background: 'white',
          border: '2px solid #4b96ff',
          borderRadius: '8px',
          padding: '10px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
        }
      }, 'Resizable Window')`;

      const windowNode = cy.addFloatingWindow({
        id: 'resizable-window',
        component: TestComponent,
        position: { x: 300, y: 300 },
        resizable: true
      });

      window.windowNode = windowNode;

      const windowElement = document.querySelector('#window-resizable-window') as HTMLElement;
      return {
        nodeExists: windowNode.length > 0,
        hasResizableClass: windowElement.classList.contains('resizable'),
        initialWidth: windowElement.offsetWidth,
        initialHeight: windowElement.offsetHeight,
        initialPosition: windowNode.position()
      };
    });

    // ✅ Test 1: Verify resizable window created
    expect(setup.nodeExists).toBe(true);
    expect(setup.hasResizableClass).toBe(true);

    // ✅ Test 2: Simulate resize by changing dimensions
    await page.evaluate(() => {
      const windowElement = document.querySelector('#window-resizable-window') as HTMLElement;
      windowElement.style.width = '300px';
      windowElement.style.height = '200px';
    });

    const afterResize = await page.evaluate(() => {
      const windowElement = document.querySelector('#window-resizable-window') as HTMLElement;
      const windowNode = window.cy.getElementById('resizable-window');
      return {
        width: windowElement.offsetWidth,
        height: windowElement.offsetHeight,
        nodePosition: windowNode.position()
      };
    });

    // ✅ Test 3: Dimensions should update
    expect(afterResize.width).toBe(300);
    expect(afterResize.height).toBe(200);

    // ✅ Test 4: Position anchor should remain at center (node position unchanged)
    expect(afterResize.nodePosition).toEqual(setup.initialPosition);

    // ✅ Test 5: Resized dimensions should persist during pan
    await page.evaluate(() => {
      window.cy.pan({ x: 100, y: 100 });
    });

    const afterPan = await page.evaluate(() => {
      const windowElement = document.querySelector('#window-resizable-window') as HTMLElement;
      return {
        width: windowElement.offsetWidth,
        height: windowElement.offsetHeight
      };
    });

    expect(afterPan.width).toBe(300);
    expect(afterPan.height).toBe(200);

    // ✅ Test 6: Resized dimensions should persist during zoom
    await page.evaluate(() => {
      window.cy.zoom(1.5);
    });

    const afterZoom = await page.evaluate(() => {
      const windowElement = document.querySelector('#window-resizable-window') as HTMLElement;
      return {
        width: windowElement.offsetWidth,
        height: windowElement.offsetHeight
      };
    });

    expect(afterZoom.width).toBe(300);
    expect(afterZoom.height).toBe(200);

    // ✅ Test 7: Minimum size constraints
    await page.evaluate(() => {
      const windowElement = document.querySelector('#window-resizable-window') as HTMLElement;
      windowElement.style.width = '50px'; // Below minimum
      windowElement.style.height = '50px'; // Below minimum
    });

    const afterMinResize = await page.evaluate(() => {
      const windowElement = document.querySelector('#window-resizable-window') as HTMLElement;
      const computedStyle = window.getComputedStyle(windowElement);
      return {
        minWidth: computedStyle.minWidth,
        minHeight: computedStyle.minHeight,
        actualWidth: windowElement.offsetWidth,
        actualHeight: windowElement.offsetHeight
      };
    });

    expect(afterMinResize.minWidth).toBe('100px');
    expect(afterMinResize.minHeight).toBe('100px');
    // Browser enforces minimum size
    expect(afterMinResize.actualWidth).toBeGreaterThanOrEqual(100);
    expect(afterMinResize.actualHeight).toBeGreaterThanOrEqual(100);

    // ✅ Test 8: Screenshot
    await page.screenshot({
      path: 'tests/screenshots/floating-window-resized.png',
      clip: { x: 0, y: 0, width: 800, height: 600 }
    });
  });
});
