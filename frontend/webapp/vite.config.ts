/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// https://vite.dev/config/
export default defineConfig(async () => {
  const { default: tailwindcss } = await import("@tailwindcss/vite");

  return {
    plugins: [react(), tailwindcss()],
    base: "./", // Use relative paths for assets (needed for Electron)
    server: {
      port: 3000,
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    build: {
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, "index.html"),
          floatingEditorE2E: path.resolve(__dirname, "floating-editor-e2e-test.html"),
        },
      },
    },
    test: {
      globals: true,
      environment: "jsdom",
      setupFiles: "./src/test/setup.ts",
      include: ["tests/unit/**/*.test.{ts,tsx}", "tests/integration/**/*.test.{ts,tsx}"],
      exclude: ["node_modules/**", "dist/**", "tests/e2e/**"],
      coverage: {
        provider: "v8",
        reporter: ["text", "json", "html"],
      },
    },
  };
});
