// tests/e2e/isolated-with-harness/graph-core/floating-window-dimensions-debug.spec.ts
// Test to debug dimensional mismatch between ghost nodes and floating windows

import { test, expect } from '@playwright/test';

test.describe('Floating Window Dimension Synchronization Debug', () => {

  test('should compare ghost node dimensions vs floating window bounding box', async ({ page }) => {
    // Listen to console messages
    page.on('console', msg => {
      console.log(`Browser: ${msg.text()}`);
    });

    // Navigate to test harness
    await page.goto('/tests/e2e/isolated-with-harness/graph-core/cytoscape-react-harness.html');
    await page.waitForSelector('[data-harness-ready="true"]');

    // Create a parent node and a Terminal floating window
    const dimensions = await page.evaluate(() => {
      const cy = window.cy;

      // Add a parent node
      cy.add([
        { data: { id: 'parent-node' }, position: { x: 200, y: 200 } }
      ]);

      // Add Terminal floating window as child of parent-node
      cy.addFloatingWindow({
        id: 'terminal-1',
        component: 'Terminal',
        position: { x: 400, y: 200 },
        nodeData: {
          parentNodeId: 'parent-node'
        },
        title: 'Test Terminal'
      });

      // Wait a tick for ResizeObserver to fire
      return new Promise(resolve => {
        setTimeout(() => {
          const windowElement = document.querySelector('#window-terminal-1') as HTMLElement;
          const shadowNode = cy.getElementById('terminal-1');

          // Get all dimension measurements
          const result = {
            // Window element measurements
            windowOffsetWidth: windowElement.offsetWidth,  // Includes border + padding + content
            windowOffsetHeight: windowElement.offsetHeight,
            windowClientWidth: windowElement.clientWidth,  // Includes padding + content (no border)
            windowClientHeight: windowElement.clientHeight,
            windowScrollWidth: windowElement.scrollWidth,
            windowScrollHeight: windowElement.scrollHeight,
            windowBoundingBox: windowElement.getBoundingClientRect(),
            windowStyleWidth: windowElement.style.width,
            windowStyleHeight: windowElement.style.height,

            // Shadow node measurements (from Cytoscape)
            shadowNodeWidth: shadowNode.width(),
            shadowNodeHeight: shadowNode.height(),
            shadowNodeStyle: {
              width: shadowNode.style('width'),
              height: shadowNode.style('height')
            },
            shadowNodeBoundingBox: shadowNode.boundingBox(),

            // Title bar measurements
            titleBarHeight: (() => {
              const titleBar = windowElement.querySelector('.cy-floating-window-title') as HTMLElement;
              return titleBar ? titleBar.offsetHeight : 0;
            })(),

            // Content area measurements
            contentHeight: (() => {
              const content = windowElement.querySelector('.cy-floating-window-content') as HTMLElement;
              return content ? content.offsetHeight : 0;
            })(),

            // Computed styles
            windowComputedStyle: (() => {
              const computed = window.getComputedStyle(windowElement);
              return {
                width: computed.width,
                height: computed.height,
                borderTopWidth: computed.borderTopWidth,
                borderBottomWidth: computed.borderBottomWidth,
                borderLeftWidth: computed.borderLeftWidth,
                borderRightWidth: computed.borderRightWidth,
                paddingTop: computed.paddingTop,
                paddingBottom: computed.paddingBottom,
                paddingLeft: computed.paddingLeft,
                paddingRight: computed.paddingRight,
                boxSizing: computed.boxSizing
              };
            })()
          };

          resolve(result);
        }, 500);  // Give ResizeObserver time to fire
      });
    });

    // Log all dimensions for debugging
    console.log('=== DIMENSION COMPARISON ===');
    console.log('Window Element (Visual):');
    console.log(`  offset (rendered size): ${dimensions.windowOffsetWidth} x ${dimensions.windowOffsetHeight}`);
    console.log(`  client (content area): ${dimensions.windowClientWidth} x ${dimensions.windowClientHeight}`);
    console.log(`  bounding box: ${JSON.stringify(dimensions.windowBoundingBox)}`);
    console.log(`  style: ${dimensions.windowStyleWidth} x ${dimensions.windowStyleHeight}`);
    console.log('\nWindow Component Breakdown:');
    console.log(`  title bar height: ${dimensions.titleBarHeight}px`);
    console.log(`  content height: ${dimensions.contentHeight}px`);
    console.log('\nShadow Node (Layout Algorithm):');
    console.log(`  width(): ${dimensions.shadowNodeWidth}`);
    console.log(`  height(): ${dimensions.shadowNodeHeight}`);
    console.log(`  style: ${JSON.stringify(dimensions.shadowNodeStyle)}`);
    console.log(`  bounding box: ${JSON.stringify(dimensions.shadowNodeBoundingBox)}`);
    console.log('\nComputed Style:');
    console.log(`  ${JSON.stringify(dimensions.windowComputedStyle, null, 2)}`);
    console.log('\n=== MISMATCH ANALYSIS ===');
    console.log(`Width difference (offset - shadow): ${dimensions.windowOffsetWidth - dimensions.shadowNodeWidth}`);
    console.log(`Height difference (offset - shadow): ${dimensions.windowOffsetHeight - dimensions.shadowNodeHeight}`);

    // The key assertion: Shadow node dimensions should match the VISUAL size of the window
    // (offsetWidth/offsetHeight), not the content area (clientWidth/clientHeight)
    // This ensures the layout algorithm spaces nodes correctly

    // Allow small tolerance for rounding
    const tolerance = 5;

    // Check width
    expect(Math.abs(dimensions.windowOffsetWidth - dimensions.shadowNodeWidth)).toBeLessThan(tolerance);

    // Check height
    expect(Math.abs(dimensions.windowOffsetHeight - dimensions.shadowNodeHeight)).toBeLessThan(tolerance);
  });

  test('should compare multiple window types (Terminal vs MarkdownEditor)', async ({ page }) => {
    await page.goto('/tests/e2e/isolated-with-harness/graph-core/cytoscape-react-harness.html');
    await page.waitForSelector('[data-harness-ready="true"]');

    const comparison = await page.evaluate(() => {
      const cy = window.cy;

      // Add parent node
      cy.add([
        { data: { id: 'parent' }, position: { x: 200, y: 200 } }
      ]);

      // Add Terminal
      cy.addFloatingWindow({
        id: 'terminal-1',
        component: 'Terminal',
        position: { x: 400, y: 200 },
        nodeData: { parentNodeId: 'parent' }
      });

      // Add MarkdownEditor
      cy.addFloatingWindow({
        id: 'editor-1',
        component: 'MarkdownEditor',
        position: { x: 700, y: 200 },
        nodeData: { parentNodeId: 'parent' }
      });

      return new Promise(resolve => {
        setTimeout(() => {
          const terminalWindow = document.querySelector('#window-terminal-1') as HTMLElement;
          const editorWindow = document.querySelector('#window-editor-1') as HTMLElement;
          const terminalShadow = cy.getElementById('terminal-1');
          const editorShadow = cy.getElementById('editor-1');

          resolve({
            terminal: {
              windowSize: { w: terminalWindow.offsetWidth, h: terminalWindow.offsetHeight },
              shadowSize: { w: terminalShadow.width(), h: terminalShadow.height() },
              diff: {
                w: terminalWindow.offsetWidth - terminalShadow.width(),
                h: terminalWindow.offsetHeight - terminalShadow.height()
              }
            },
            editor: {
              windowSize: { w: editorWindow.offsetWidth, h: editorWindow.offsetHeight },
              shadowSize: { w: editorShadow.width(), h: editorShadow.height() },
              diff: {
                w: editorWindow.offsetWidth - editorShadow.width(),
                h: editorWindow.offsetHeight - editorShadow.height()
              }
            }
          });
        }, 500);
      });
    });

    console.log('=== MULTI-WINDOW COMPARISON ===');
    console.log('Terminal:', comparison.terminal);
    console.log('Editor:', comparison.editor);

    // Both should have matching dimensions
    expect(Math.abs(comparison.terminal.diff.w)).toBeLessThan(5);
    expect(Math.abs(comparison.terminal.diff.h)).toBeLessThan(5);
    expect(Math.abs(comparison.editor.diff.w)).toBeLessThan(5);
    expect(Math.abs(comparison.editor.diff.h)).toBeLessThan(5);
  });

  test('should trigger layout when resizing changes dimensions', async ({ page }) => {
    await page.goto('/tests/e2e/isolated-with-harness/graph-core/cytoscape-react-harness.html');
    await page.waitForSelector('[data-harness-ready="true"]');

    const layoutTest = await page.evaluate(() => {
      const cy = window.cy;
      const layoutManager = (window as any).layoutManager;
      const results = [];

      // Add parent node
      cy.add([
        { data: { id: 'parent' }, position: { x: 200, y: 200 } }
      ]);

      // Create first terminal
      cy.addFloatingWindow({
        id: 'terminal-1',
        component: 'Terminal',
        position: { x: 500, y: 200 },
        nodeData: { parentNodeId: 'parent' },
        resizable: true
      });

      // Initialize layout with these nodes
      return layoutManager.applyLayout(cy, ['parent', 'terminal-1']).then(() => {
        return new Promise(resolve => {
          setTimeout(() => {
            const windowElement = document.querySelector('#window-terminal-1') as HTMLElement;
            const shadowNode = cy.getElementById('terminal-1');

            // Step 1: Initial state after layout
            const initialPos = shadowNode.position();
            results.push({
              step: 'initial',
              position: { x: initialPos.x, y: initialPos.y },
              size: { w: shadowNode.width(), h: shadowNode.height() }
            });

            // Step 2: Resize 3x larger
            const initialWidth = windowElement.offsetWidth;
            const initialHeight = windowElement.offsetHeight;
            windowElement.style.width = `${initialWidth * 3}px`;
            windowElement.style.height = `${initialHeight * 3}px`;

            // Wait for ResizeObserver to sync dimensions
            setTimeout(() => {
              const afterResizePos = shadowNode.position();
              results.push({
                step: 'after-resize-3x',
                position: { x: afterResizePos.x, y: afterResizePos.y },
                size: { w: shadowNode.width(), h: shadowNode.height() },
                positionChanged: Math.abs(afterResizePos.x - initialPos.x) > 5 || Math.abs(afterResizePos.y - initialPos.y) > 5
              });

              // Step 3: Add sibling - this should trigger layout and move both
              cy.addFloatingWindow({
                id: 'terminal-2',
                component: 'Terminal',
                position: { x: 700, y: 200 },
                nodeData: { parentNodeId: 'parent' }
              });

              layoutManager.applyLayout(cy, ['terminal-2']).then(() => {
                setTimeout(() => {
                  const afterSiblingPos = shadowNode.position();
                  const siblingShadow = cy.getElementById('terminal-2');
                  const siblingPos = siblingShadow.position();

                  results.push({
                    step: 'after-sibling-added',
                    terminal1Position: { x: afterSiblingPos.x, y: afterSiblingPos.y },
                    terminal1Size: { w: shadowNode.width(), h: shadowNode.height() },
                    terminal2Position: { x: siblingPos.x, y: siblingPos.y },
                    terminal2Size: { w: siblingShadow.width(), h: siblingShadow.height() },
                    terminal1Moved: Math.abs(afterSiblingPos.x - afterResizePos.x) > 5 || Math.abs(afterSiblingPos.y - afterResizePos.y) > 5
                  });

                  resolve(results);
                }, 300);
              });
            }, 300);
          }, 500);
        });
      });
    });

    console.log('\n=== LAYOUT UPDATE TEST ===');
    for (const result of layoutTest) {
      console.log(`\n${result.step}:`);
      if (result.position) {
        console.log(`  Position: (${result.position.x.toFixed(1)}, ${result.position.y.toFixed(1)})`);
        console.log(`  Size: ${result.size.w} x ${result.size.h}`);
        if (result.positionChanged !== undefined) {
          console.log(`  Position changed: ${result.positionChanged}`);
        }
      }
      if (result.terminal1Position) {
        console.log(`  Terminal 1: (${result.terminal1Position.x.toFixed(1)}, ${result.terminal1Position.y.toFixed(1)}) ${result.terminal1Size.w}x${result.terminal1Size.h}`);
        console.log(`  Terminal 2: (${result.terminal2Position.x.toFixed(1)}, ${result.terminal2Position.y.toFixed(1)}) ${result.terminal2Size.w}x${result.terminal2Size.h}`);
        console.log(`  Terminal 1 moved after sibling added: ${result.terminal1Moved}`);
      }
    }

    // Verify layout actually ran - positions should change
    const afterResize = layoutTest.find(r => r.step === 'after-resize-3x');
    const afterSibling = layoutTest.find(r => r.step === 'after-sibling-added');

    // After resize 3x, layout should update and position should change
    expect(afterResize.positionChanged).toBe(true);

    // After adding sibling, layout should run and move the large terminal
    expect(afterSibling.terminal1Moved).toBe(true);
  });

  test('should maintain 1:1 dimensions after manual resize', async ({ page }) => {
    await page.goto('/tests/e2e/isolated-with-harness/graph-core/cytoscape-react-harness.html');
    await page.waitForSelector('[data-harness-ready="true"]');

    const resizeTest = await page.evaluate(() => {
      const cy = window.cy;

      cy.addFloatingWindow({
        id: 'resizable-1',
        component: 'Terminal',
        position: { x: 300, y: 300 },
        resizable: true
      });

      return new Promise(resolve => {
        setTimeout(() => {
          const windowElement = document.querySelector('#window-resizable-1') as HTMLElement;
          const shadowNode = cy.getElementById('resizable-1');

          // Get initial dimensions
          const before = {
            windowSize: { w: windowElement.offsetWidth, h: windowElement.offsetHeight },
            shadowSize: { w: shadowNode.width(), h: shadowNode.height() }
          };

          // Manually resize the window
          windowElement.style.width = '800px';
          windowElement.style.height = '500px';

          // Wait for ResizeObserver to fire
          setTimeout(() => {
            const after = {
              windowSize: { w: windowElement.offsetWidth, h: windowElement.offsetHeight },
              shadowSize: { w: shadowNode.width(), h: shadowNode.height() }
            };

            resolve({ before, after });
          }, 200);
        }, 500);
      });
    });

    console.log('=== RESIZE TEST ===');
    console.log('Before:', resizeTest.before);
    console.log('After:', resizeTest.after);

    // After resize, dimensions should still match
    expect(Math.abs(resizeTest.after.windowSize.w - resizeTest.after.shadowSize.w)).toBeLessThan(5);
    expect(Math.abs(resizeTest.after.windowSize.h - resizeTest.after.shadowSize.h)).toBeLessThan(5);
  });
});
