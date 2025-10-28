/**
 * VS Code Terminal Transform Test
 *
 * Injects CSS transform overlay onto VS Code terminal to test if transforms
 * cause bugs (viewport resets, scroll issues, etc.)
 *
 * Usage:
 * 1. Run VS Code from source: cd /path/to/vscode && ./scripts/code.sh
 * 2. Open a terminal (Ctrl+`)
 * 3. Open Dev Tools: Help > Toggle Developer Tools
 * 4. Paste this entire file into the Console
 * 5. Run test commands (see below)
 */

// Find the terminal container
const terminalContainer = document.querySelector('.terminal-outer-container');
if (!terminalContainer) {
  console.error('❌ Terminal not found! Open a terminal first (Ctrl+`)');
} else {
  console.log('✅ Found terminal:', terminalContainer);

  // Create overlay system (like VoiceTree floating windows)
  const overlay = document.createElement('div');
  overlay.id = 'test-transform-overlay';
  overlay.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 1000;
    transform-origin: top left;
    border: 2px solid red;
  `;

  // Wrap terminal in overlay
  const parent = terminalContainer.parentElement;
  parent.style.position = 'relative';
  parent.style.overflow = 'hidden';

  // Move terminal into overlay
  overlay.appendChild(terminalContainer);
  parent.appendChild(overlay);

  // Re-enable pointer events on terminal
  terminalContainer.style.pointerEvents = 'auto';

  // Test transform controls
  let zoom = 1.0;
  let pan = { x: 0, y: 0 };

  function updateTransform() {
    overlay.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
    console.log(`Transform: zoom=${zoom.toFixed(2)}, pan=(${pan.x}, ${pan.y})`);
  }

  // Expose controls to console
  window.testTransforms = {
    zoomIn: () => {
      zoom *= 1.2;
      updateTransform();
      console.log('⬆️ Zoomed in');
    },

    zoomOut: () => {
      zoom *= 0.8;
      updateTransform();
      console.log('⬇️ Zoomed out');
    },

    panRight: () => {
      pan.x += 50;
      updateTransform();
      console.log('➡️ Panned right');
    },

    panLeft: () => {
      pan.x -= 50;
      updateTransform();
      console.log('⬅️ Panned left');
    },

    panDown: () => {
      pan.y += 50;
      updateTransform();
      console.log('⬇️ Panned down');
    },

    panUp: () => {
      pan.y -= 50;
      updateTransform();
      console.log('⬆️ Panned up');
    },

    reset: () => {
      zoom = 1.0;
      pan = { x: 0, y: 0 };
      updateTransform();
      console.log('🔄 Reset to default');
    },

    // Animated test - 60 seconds of continuous transform changes
    animate: () => {
      console.log('🎬 Starting 60-second animation test...');
      let direction = 1;
      let frameCount = 0;

      const interval = setInterval(() => {
        zoom += 0.05 * direction;
        pan.x += 10 * direction;
        frameCount++;

        if (zoom > 1.5 || zoom < 0.7) {
          direction *= -1;
        }

        updateTransform();

        // Log progress every 10 seconds
        if (frameCount % 100 === 0) {
          console.log(`⏱️  ${Math.floor(frameCount / 10)} seconds elapsed...`);
        }
      }, 100); // 100ms = 10 frames/second

      // Stop after 60 seconds
      setTimeout(() => {
        clearInterval(interval);
        testTransforms.reset();
        console.log('✅ 60-second animation test complete!');
      }, 60000); // 60 seconds

      console.log('💡 Watch for:');
      console.log('   - Scroll position jumping');
      console.log('   - Viewport resets');
      console.log('   - Visual glitches');
      console.log('   - Output flickering');
    },

    // Stress test - rapid transforms
    stress: () => {
      console.log('⚡ Starting stress test (10 seconds, rapid transforms)...');
      let count = 0;

      const interval = setInterval(() => {
        // Random transforms
        zoom = 0.8 + Math.random() * 0.8; // 0.8-1.6
        pan.x = -100 + Math.random() * 200; // -100 to 100
        pan.y = -100 + Math.random() * 200;
        updateTransform();
        count++;
      }, 50); // Very fast - 20 transforms/second

      setTimeout(() => {
        clearInterval(interval);
        testTransforms.reset();
        console.log(`✅ Stress test complete! (${count} transforms)`);
      }, 10000);
    }
  };

  console.log('\n🎯 Transform overlay injected successfully!\n');
  console.log('📋 Available commands:');
  console.log('   testTransforms.zoomIn()     - Zoom in 20%');
  console.log('   testTransforms.zoomOut()    - Zoom out 20%');
  console.log('   testTransforms.panRight()   - Pan right 50px');
  console.log('   testTransforms.panLeft()    - Pan left 50px');
  console.log('   testTransforms.panUp()      - Pan up 50px');
  console.log('   testTransforms.panDown()    - Pan down 50px');
  console.log('   testTransforms.reset()      - Reset to default');
  console.log('   testTransforms.animate()    - 60-second animation test');
  console.log('   testTransforms.stress()     - 10-second stress test');
  console.log('\n🧪 Suggested test procedure:');
  console.log('1. In terminal, run: for i in {1..100}; do echo "Line $i"; done');
  console.log('2. Scroll up to line 50');
  console.log('3. Run: testTransforms.animate()');
  console.log('4. Watch for scroll position jumps or viewport resets');
  console.log('5. Try: clear (does it break?)');
  console.log('6. Try: vim test.txt (does it work while transformed?)');
}
