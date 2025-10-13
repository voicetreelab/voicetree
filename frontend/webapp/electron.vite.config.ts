import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'
import path from 'path'

/**
 * Electron-Vite configuration
 * This is the PRIMARY config for development (npm run electron)
 */
export default defineConfig({
  main: {
    // Configuration for electron main process
    plugins: [externalizeDepsPlugin()],
    logLevel: 'error',
    build: {
      outDir: 'dist-electron/main',
      logLevel: 'error',
      watch: {
        buildDelay: 500 // Debounce rebuilds by 500ms to reduce restart frequency
      },
      rollupOptions: {
        input: {
          index: path.resolve(__dirname, 'electron/main.ts')
        }
      }
    }
  },
  preload: {
    // Configuration for preload script
    plugins: [externalizeDepsPlugin()],
    logLevel: 'error',
    build: {
      outDir: 'dist-electron/preload',
      logLevel: 'error',
      watch: {
        buildDelay: 500 // Debounce rebuilds by 500ms to reduce restart frequency
      },
      rollupOptions: {
        input: {
          index: path.resolve(__dirname, 'electron/preload.ts')
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].js'
        }
      }
    }
  },
  renderer: {
    // Configuration for React renderer
    root: '.',
    logLevel: 'error',
    plugins: [
      react(),
      tailwindcss(),
      topLevelAwait(),
      wasm()
    ],
    base: './',
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@wasm': path.resolve(__dirname, './tidy/wasm_dist')
      }
    },
    optimizeDeps: {
      exclude: ['mermaid']
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
      target: 'esnext',
      logLevel: 'error',
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html')
        }
      }
    }
  }
})
