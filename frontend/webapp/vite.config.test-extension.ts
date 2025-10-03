/**
 * Vite config for bundling the floating windows extension for test environment
 *
 * This creates a browser-compatible IIFE bundle that can be loaded in test harness HTML
 */
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/graph-core/extensions/cytoscape-floating-windows.ts'),
      name: 'FloatingWindowsExtension',
      formats: ['iife'],
      fileName: 'floating-windows-extension'
    },
    outDir: 'tests/e2e/isolated-with-harness/graph-core/dist',
    emptyOutDir: false,
    // Skip type checking and minification for faster builds
    minify: false,
    rollupOptions: {
      // Mark cytoscape and React as external - they're loaded via CDN in test harness
      external: ['cytoscape', 'react', 'react-dom'],
      output: {
        globals: {
          cytoscape: 'cytoscape',
          react: 'React',
          'react-dom': 'ReactDOM'
        }
      }
    }
  },
  // Don't fail on TypeScript errors - we just need JavaScript output
  esbuild: {
    logOverride: { 'this-is-undefined-in-esm': 'silent' }
  }
});
