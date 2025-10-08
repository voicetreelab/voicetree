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
    build: {
      outDir: 'dist-electron/main',
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
    build: {
      outDir: 'dist-electron/preload',
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
    plugins: [react(), tailwindcss(), wasm(), topLevelAwait()],
    base: './',
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src')
      }
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
          main: path.resolve(__dirname, 'index.html')
        }
      }
    }
  }
})
