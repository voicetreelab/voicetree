/**
 * Live test: Add child node to orphan node that has an anchored editor (shadow node).
 *
 * Bug: The child spawns directly to the RIGHT at angle 0° — same direction as the
 * editor shadow node. This puts the child inline between parent and editor, creating
 * a visual mess. The child should spawn at a different angle to avoid the shadow.
 *
 * Run against a live Electron app with CDP enabled:
 *   ENABLE_PLAYWRIGHT_DEBUG=1 npm run electron
 *   node webapp/e2e-tests/playwright-browser/live_test_scripts/add-child-to-orphan-with-editor.cjs
 *
 * Requires: playwright in node_modules
 */
const path = require('path');
const { chromium } = require(path.join(__dirname, '../../../node_modules/playwright'));

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const page = browser.contexts()[0]?.pages()[0];

  // Ensure app is loaded with project open
  const hasCy = await page.evaluate(() => typeof window.cytoscapeInstance === 'object' && window.cytoscapeInstance !== null);
  if (!hasCy) {
    console.log('Re-opening project...');
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('voicetree-public'));
      if (btn) btn.click();
    });
    for (let i = 0; i < 15; i++) {
      const ready = await page.evaluate(() => typeof window.cytoscapeInstance === 'object' && window.cytoscapeInstance !== null);
      if (ready) break;
      await page.waitForTimeout(1000);
    }
  }
  console.log('1. App ready');

  // Clean up any previous test nodes
  await page.evaluate(async () => {
    const cy = window.cytoscapeInstance;
    const ids = cy.nodes().filter(n => n.id().includes('ORPHAN_EDITOR_TEST'))
      .map(n => n.id()).filter(id => id.indexOf('shadowNode') === -1);
    if (ids.length > 0) {
      await window.electronAPI.main.applyGraphDeltaToDBThroughMemUIAndEditorExposed(
        ids.map(id => ({ type: 'DeleteNode', nodeId: id, deletedNode: { _tag: 'None' } }))
      );
    }
  });
  await page.waitForTimeout(500);

  // Step 1: Create orphan node in a clear area
  const nodeId = await page.evaluate(async () => {
    const writePath = (await window.electronAPI.main.getWritePath()).value;
    const nodeId = writePath + '/' + Date.now() + 'ORPHAN_EDITOR_TEST.md';
    await window.electronAPI.main.applyGraphDeltaToDBThroughMemUIAndEditorExposed([{
      type: 'UpsertNode',
      nodeToUpsert: {
        absoluteFilePathIsID: nodeId,
        outgoingEdges: [],
        contentWithoutYamlOrLinks: '# Orphan With Shadow',
        nodeUIMetadata: {
          color: { _tag: 'None' },
          position: { _tag: 'Some', value: { x: -10000, y: -10000 } },
          additionalYAMLProps: new Map(),
          isContextNode: false
        }
      },
      previousNode: { _tag: 'None' }
    }]);
    return nodeId;
  });
  console.log('2. Created orphan:', nodeId.split('/').pop());

  // Step 2: Center on orphan
  await page.evaluate((id) => {
    const cy = window.cytoscapeInstance;
    cy.center(cy.getElementById(id));
    cy.zoom({ level: 0.5, renderedPosition: { x: cy.width()/2, y: cy.height()/2 } });
  }, nodeId);
  await page.waitForTimeout(1000);

  // Step 3: Click node to hover, then pin editor to create anchored editor with shadow
  // First, move mouse away to clear any state
  await page.mouse.move(10, 10);
  await page.waitForTimeout(500);

  // Click on node (opens hover editor)
  const coords = await page.evaluate((id) => {
    const cy = window.cytoscapeInstance;
    const container = cy.container();
    const rect = container.getBoundingClientRect();
    const rp = cy.getElementById(id).renderedPosition();
    return { x: rect.left + rp.x, y: rect.top + rp.y };
  }, nodeId);
  await page.mouse.click(coords.x, coords.y);
  await page.waitForTimeout(1500);

  // Click the pin button (traffic light) to convert hover editor to anchored editor
  const pinned = await page.evaluate(() => {
    const btn = document.querySelector('.traffic-light.traffic-light-pin');
    if (btn) { btn.click(); return true; }
    return false;
  });
  if (!pinned) {
    console.log('ERROR: Could not find pin button');
    await browser.close();
    return;
  }
  await page.waitForTimeout(2000);

  // Step 4: Verify shadow node exists
  const hasShadow = await page.evaluate((id) => {
    const cy = window.cytoscapeInstance;
    return cy.nodes().filter(n => n.data('parentNodeId') === id && n.data('isShadowNode') === true).length > 0;
  }, nodeId);
  if (!hasShadow) {
    console.log('ERROR: Shadow node not created');
    await browser.close();
    return;
  }

  // Record BEFORE state
  const beforeState = await page.evaluate((id) => {
    const cy = window.cytoscapeInstance;
    const parent = cy.getElementById(id);
    const nearby = cy.nodes().filter(n => {
      return Math.abs(n.position().x - parent.position().x) < 1500 &&
             Math.abs(n.position().y - parent.position().y) < 1500;
    });
    return nearby.map(n => ({
      id: n.id().split('/').pop(),
      isShadow: n.data('isShadowNode') === true,
      dx: Math.round(n.position().x - parent.position().x),
      dy: Math.round(n.position().y - parent.position().y)
    }));
  }, nodeId);
  console.log('\n=== BEFORE Cmd+N ===');
  for (const n of beforeState) {
    const tag = n.isShadow ? ' (shadow)' : '';
    console.log('  ' + n.id + tag + ': dx=' + n.dx + ', dy=' + n.dy);
  }

  console.log('\n3. Orphan has pinned editor with shadow. Pausing 4s...');
  await page.waitForTimeout(4000);

  // Step 5: Select node and create child via Cmd+N
  await page.evaluate((id) => window.cytoscapeInstance.getElementById(id).select(), nodeId);
  console.log('4. Pressing Cmd+N to create child...');
  await page.keyboard.press('Meta+n');
  await page.waitForTimeout(5000);

  // Step 6: Record AFTER state
  const afterState = await page.evaluate((id) => {
    const cy = window.cytoscapeInstance;
    const parent = cy.getElementById(id);
    const nearby = cy.nodes().filter(n => {
      return Math.abs(n.position().x - parent.position().x) < 2000 &&
             Math.abs(n.position().y - parent.position().y) < 2000;
    });
    return nearby.map(n => ({
      id: n.id().split('/').pop(),
      isShadow: n.data('isShadowNode') === true,
      dx: Math.round(n.position().x - parent.position().x),
      dy: Math.round(n.position().y - parent.position().y)
    }));
  }, nodeId);

  console.log('\n=== AFTER Cmd+N ===');
  for (const n of afterState) {
    const side = n.dx > 0 ? 'RIGHT' : n.dx < 0 ? 'LEFT' : 'CENTER';
    const tag = n.isShadow ? ' (shadow)' : '';
    console.log('  ' + n.id + tag + ': dx=' + n.dx + ', dy=' + n.dy + ' [' + side + ']');
  }

  // Bug check: child should NOT be on the same line (dy≈0) as the shadow
  const child = afterState.find(n => n.id.includes('_0.md') && !n.isShadow);
  const parentShadow = afterState.find(n => n.isShadow && !n.id.includes('_0'));
  if (child && parentShadow) {
    const childInline = Math.abs(child.dy) < 50 && child.dx > 0 && child.dx < parentShadow.dx;
    console.log('\n=== BUG CHECK ===');
    console.log('  Child dx=' + child.dx + ', dy=' + child.dy);
    console.log('  Parent shadow dx=' + parentShadow.dx);
    console.log('  Child inline between parent and shadow? ' + (childInline ? 'YES - BUG!' : 'NO'));
  }

  await page.screenshot({ path: path.join(__dirname, '../../../e2e-tests/screenshots/orphan-child-editor-bug.png') });
  console.log('\nScreenshot saved to e2e-tests/screenshots/');
  await browser.close();
})().catch(e => console.error(e));
