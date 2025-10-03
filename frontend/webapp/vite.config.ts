/// <reference types="vitest" />
import {defineConfig} from "vite";
import { getRendererConfig } from "./vite.renderer.config";

// https://vite.dev/config/
export default defineConfig(async () => {
    const rendererConfig = await getRendererConfig();

    return {
        ...rendererConfig,
        test: {
            globals: true,
            environment: "jsdom",
            setupFiles: "./src/test/setup.ts",
            include: ["tests/unit/**/*.test.{ts,tsx}", "tests/component/**/*.test.{ts,tsx}", "tests/integration/**/*.test.{ts,tsx}"],
            exclude: ["node_modules/**", "dist/**", "tests/e2e/**"],
            reporters: [
                ['default', {summary: false, verbose: false}],
            ],
            silent: true, // Hides console for passing tests, shows for failing tests
            coverage: {
                provider: "v8",
                reporter: ["text", "json", "html"],
            },
        },
    };
});
