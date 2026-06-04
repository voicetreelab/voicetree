// defineConfig from vitest/config (not vite) so the `test` block below is typed —
// vite's own defineConfig has no `test` property, and a `/// <reference>` shim is
// not honored under tsconfig.app.json.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import path from "path";
import { createRequire } from "module";
import { lanCspPlugin } from "./vite-plugins/lanCsp";

const require = createRequire(import.meta.url);
const ciCheckReporter = require.resolve("@vt/measures/vitest-reporter");
const disableDevServerWatch = process.env.VT_DISABLE_DEV_SERVER_WATCH === "1";
const devServerWatchIgnoredPaths = [
  "**/dist/**",
  "**/dist-electron/**",
  "**/resources/**",
  "**/.venv*/**",
  "**/node_modules/**"
];

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
    topLevelAwait(),
    // Widen the static CSP to the LAN VTD origin when `vt webapp --lan` sets
    // VITE_VTD_URL to a non-loopback host; a no-op for loopback launches.
    lanCspPlugin()
  ],
  base: "./",
  resolve: {
    alias: [
      { find: /^@vt\/graph-state$/, replacement: path.resolve(__dirname, "../packages/libraries/graph-state/src/index.ts") },
      { find: /^@vt\/graph-state\/(.+)$/, replacement: path.resolve(__dirname, "../packages/libraries/graph-state/src/$1") },
      { find: /^@vt\/graph-model$/, replacement: path.resolve(__dirname, "../packages/libraries/graph-model/src/index.ts") },
      { find: /^@vt\/graph-model\/(.+)$/, replacement: path.resolve(__dirname, "../packages/libraries/graph-model/src/$1") },
      { find: /^@root(?=\/)/, replacement: path.resolve(__dirname, ".") },
      { find: /^@(?=\/)/, replacement: path.resolve(__dirname, "./src") },
      // Alias CSS imports from @material to prevent import errors
      { find: '@material/mwc-icon/mwc-icon-host.css', replacement: path.resolve(__dirname, 'src/utils/empty-css-export.ts') },
    ],
  },
  optimizeDeps: {
    // Exclude ninja-keys from pre-bundling so our virtual module plugin can handle the CSS import
    exclude: ['ninja-keys']
  },
  server: {
    port: 3000,
    hmr: disableDevServerWatch ? false : undefined,
    watch: disableDevServerWatch
      ? null
      : { ignored: devServerWatchIgnoredPaths }
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
    setupFiles: "./e2e-tests/setup.ts",
    include: ["src/**/*.test.{ts,tsx}", "vite-plugins/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**", "e2e-tests/**"],
    reporters: [
      ['default', {summary: false, verbose: false}],
      [ciCheckReporter, {
        checkId: 'webapp-unit',
        checkName: 'Webapp Unit (vitest)',
        command: 'npm --workspace webapp exec -- vitest run',
      }],
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
