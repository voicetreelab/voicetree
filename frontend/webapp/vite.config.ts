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
  plugins: [react(), tailwindcss(), wasm(), topLevelAwait()],
  base: "./",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
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
    include: ["tests/unit/**/*.test.{ts,tsx}", "tests/component/**/*.test.{ts,tsx}", "tests/integration/**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", "dist/**", "tests/e2e/**"],
    reporters: [
      ['default', {summary: false, verbose: false}],
    ],
    silent: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
    },
  },
});
