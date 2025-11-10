/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import path from "path";

/**
 * Vite configuration for browser-only dev (npm run dev) and Vitest
 *
 * NOTE: This is a SECONDARY config. Primary development uses electron.vite.config.ts
 * If this config drifts from electron.vite.config.ts, that's acceptable.
 */
export default defineConfig({
  plugins: [
    // Plugin to handle CSS imports from Lit Element components (ninja-keys -> @material/mwc-icon)
    // Must run before tailwindcss plugin
    {
      name: 'lit-css',
      enforce: 'pre',
      resolveId(source, importer) {
        if (source.endsWith('.css') && importer && importer.includes('@material')) {
          // Return a virtual module ID to bypass Tailwind
          return '\0' + source + '.js'
        }
      },
      load(id) {
        if (id.startsWith('\0') && id.includes('.css.js')) {
          return 'export const styles = "";'
        }
      }
    },
    react(),
    tailwindcss(),
    wasm(),
    topLevelAwait()
  ],
  base: "./",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@test": path.resolve(__dirname, "./tests"),
      // Alias CSS imports from @material to prevent import errors
      '@material/mwc-icon/mwc-icon-host.css': path.resolve(__dirname, 'src/utils/empty-css-export.ts')
    },
  },
  optimizeDeps: {
    // Exclude ninja-keys from pre-bundling so our virtual module plugin can handle the CSS import
    exclude: ['ninja-keys']
  },
  server: {
    port: 3000,
    watch: {
      ignored: [
        '**/dist/**',
        '**/dist-electron/**',
        '**/resources/**',
        '**/.venv*/**',
        '**/node_modules/**'
      ]
    }
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./tests/setup.ts",
    include: ["src/**/*.test.{ts,tsx}", "tests/unit/**/*.test.{ts,tsx}", "tests/component/**/*.test.{ts,tsx}", "tests/integration/**/*.test.{ts,tsx}", "tests/performance/**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", "dist/**", "tests/e2e/**"],
    reporters: [
      ['default', {summary: false, verbose: false}],
    ],
    silent: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
    },
    // Prevent CPU spam by limiting concurrent test execution
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true, // Use single fork to prevent multiple Node processes
      },
    },
    fileParallelism: false, // Run test files sequentially
    testTimeout: 10000, // 10 second timeout per test
    hookTimeout: 5000, // 5 second timeout for hooks
    css: true
  },
});
