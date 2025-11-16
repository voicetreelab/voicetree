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
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src')
      }
    },
    build: {
      outDir: 'dist-electron/main',
      logLevel: 'error',
      watch: {
        buildDelay: 500 // Debounce rebuilds by 500ms to reduce restart frequency
      },
      rollupOptions: {
        input: {
          index: path.resolve(__dirname, 'src/shell/edge/main/electron/main.ts')
        }
      }
    }
  },
  preload: {
    // Configuration for preload script
    plugins: [externalizeDepsPlugin()],
    logLevel: 'error',
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src')
      }
    },
    build: {
      outDir: 'dist-electron/preload',
      logLevel: 'error',
      watch: {
        buildDelay: 500 // Debounce rebuilds by 500ms to reduce restart frequency
      },
      rollupOptions: {
        input: {
          index: path.resolve(__dirname, 'src/shell/edge/main/electron/preload.ts')
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
      topLevelAwait(),
      wasm()
    ],
    base: './',
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@wasm': path.resolve(__dirname, './tidy/wasm_dist'),
        // Alias CSS imports from @material to prevent import errors
        '@material/mwc-icon/mwc-icon-host.css': path.resolve(__dirname, 'src/utils/empty-css-export.ts')
      }
    },
    optimizeDeps: {
      // Exclude ninja-keys from pre-bundling so our virtual module plugin can handle the CSS import
      exclude: ['ninja-keys']
    },
    server: {
      port: parseInt(process.env.DEV_SERVER_PORT || '3000'),
      strictPort: true,
      host: true,
      hmr: {
        overlay: true
      },
      watch: {
        ignored: [
          '**/dist/**',
          '**/dist-electron/**',
          '**/resources/**',
          '**/.venv*/**',
          '**/node_modules/**'
        ],
        // Debounce file change events to prevent HMR loops
        awaitWriteFinish: {
          stabilityThreshold: 200,
          pollInterval: 100
        }
      }
    },
    build: {
      outDir: 'dist',
      target: 'esnext',
      logLevel: 'error',
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html')
        },
        output: {
          manualChunks: {
            'mermaid': ['mermaid']
          }
        }
      },
      commonjsOptions: {
        include: [/node_modules/],
        transformMixedEsModules: true
      }
    }
  }
})
