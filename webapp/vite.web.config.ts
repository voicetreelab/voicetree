import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'
import * as path from 'path'

const emptyModule = path.resolve(__dirname, 'src/utils/empty-node-module.ts')

/**
 * Web-only Vite config for the VoiceTree Share app.
 * Excludes all Electron/Node dependencies via resolve aliases to an empty stub.
 *
 * Usage:
 *   npx vite --config vite.web.config.ts        (dev server on port 3001)
 *   npx vite build --config vite.web.config.ts   (builds to dist-web/)
 */
export default defineConfig({
  plugins: [
    // Serve web-index.html instead of index.html for all SPA routes in dev mode
    {
      name: 'web-index-spa-fallback',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          const url = req.url || ''
          // Skip Vite internals, source files, node_modules, and asset requests
          if (url.startsWith('/@') || url.startsWith('/__') || url.startsWith('/src/') ||
              url.startsWith('/node_modules/') || path.extname(url)) {
            return next()
          }
          // Rewrite SPA routes (/, /upload, /share/:id) to web-index.html
          req.url = '/web-index.html'
          next()
        })
      }
    } satisfies Plugin,
    // Plugin to handle CSS imports from Lit Element components (ninja-keys -> @material/mwc-icon)
    // Must run before tailwindcss plugin
    {
      name: 'lit-css',
      enforce: 'pre',
      resolveId(source, importer) {
        if (source.endsWith('.css') && importer && importer.includes('@material')) {
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
  base: '/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Stub out Electron/Node dependencies for web build
      'electron': emptyModule,
      'node-pty': emptyModule,
      'electron-log': emptyModule,
      'electron-updater': emptyModule,
      'fix-path': emptyModule,
      '@vscode/ripgrep': emptyModule,
      'chokidar': emptyModule,
    },
  },
  optimizeDeps: {
    include: ['buffer'],
    exclude: ['ninja-keys']
  },
  server: {
    port: 3001,
    watch: {
      ignored: [
        '**/dist/**',
        '**/dist-electron/**',
        '**/dist-web/**',
        '**/resources/**',
        '**/.venv*/**',
        '**/node_modules/**'
      ]
    }
  },
  build: {
    outDir: 'dist-web',
    target: 'esnext',
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'web-index.html')
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
})
