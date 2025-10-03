import react from "@vitejs/plugin-react";
import path from "path";
import type { UserConfig } from "vite";

/**
 * Shared Vite renderer configuration
 * Used by both vite.config.ts (browser dev) and electron.vite.config.ts (electron)
 */
export async function getRendererConfig(): Promise<UserConfig> {
    const {default: tailwindcss} = await import("@tailwindcss/vite");

    return {
        root: '.',
        plugins: [react(), tailwindcss()],
        base: "./", // Use relative paths for assets (needed for Electron)
        resolve: {
            alias: {
                "@": path.resolve(__dirname, "./src"),
            },
        },
        server: {
            port: 3000,
            strictPort: true,
            host: true,
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
            outDir: 'dist',
            rollupOptions: {
                input: {
                    main: path.resolve(__dirname, "index.html"),
                },
            },
        },
    };
}
