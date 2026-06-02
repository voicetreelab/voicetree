import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import wasm from 'vite-plugin-wasm'
import path from 'path'
import { mainAliases, rendererAliases } from './electron.vite.config/aliases'
import { buildTimingPlugins, rollupHookTimingPlugin } from './electron.vite.config/build-timing'
import {
  ELECTRON_VITE_EXTERNALIZE_EXCLUDE,
  MAIN_RUNTIME_EXTERNALS,
  externalMainDepsPlugin,
  externalNativePlugin,
} from './electron.vite.config/externals'
import {
  bundleGraphdEntrypointPlugin,
  graphStateFixtureFilenameShimPlugin,
  litCssPlugin,
  mainCommonjsPackageBoundaryPlugin,
  rendererNodeShimPlugin,
} from './electron.vite.config/plugins'

// Detect if building for tests (npm run test:*, build:test, etc.)
const npmScript = process.env.npm_lifecycle_event || ''
const isTestBuild = npmScript.startsWith('test') || npmScript === 'build:test' || process.env.VITE_E2E_TEST === 'true'
const devServerHost: true | string = process.env.DEV_SERVER_HOST || true
const webappDir = __dirname

/**
 * Electron-Vite configuration
 * This is the PRIMARY config for development (npm run electron)
 */
export default defineConfig({
  main: {
    // Configuration for electron main process
    plugins: [
      ...buildTimingPlugins('main'),
      graphStateFixtureFilenameShimPlugin,
      mainCommonjsPackageBoundaryPlugin,
      externalNativePlugin,
      externalMainDepsPlugin,
      bundleGraphdEntrypointPlugin(webappDir),
    ],
    logLevel: 'error',
    resolve: {
      alias: mainAliases(webappDir)
    },
    build: {
      outDir: 'dist-electron/main',
      externalizeDeps: { exclude: ELECTRON_VITE_EXTERNALIZE_EXCLUDE },
      rolldownOptions: {
        input: {
          index: path.resolve(webappDir, 'src/shell/edge/main/runtime/electron/app/main.ts')
        },
        external: MAIN_RUNTIME_EXTERNALS,
        output: {
          format: 'cjs',
          entryFileNames: '[name].js'
        }
      }
    }
  },
  preload: {
    // Configuration for preload script
    plugins: [
      ...buildTimingPlugins('preload'),
      graphStateFixtureFilenameShimPlugin,
      externalNativePlugin,
    ],
    logLevel: 'error',
    resolve: {
      alias: mainAliases(webappDir)
    },
    build: {
      outDir: 'dist-electron/preload',
      externalizeDeps: { exclude: ELECTRON_VITE_EXTERNALIZE_EXCLUDE },
      rolldownOptions: {
        input: {
          index: path.resolve(webappDir, 'src/shell/edge/main/runtime/electron/app/preload.ts')
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
      rollupHookTimingPlugin('renderer'),
      ...buildTimingPlugins('renderer'),
      rendererNodeShimPlugin,
      externalNativePlugin,
      litCssPlugin,
      react(),
      tailwindcss(),
      wasm()
    ],
    base: './',
    resolve: {
      alias: rendererAliases(webappDir)
    },
    optimizeDeps: {
      // Exclude ninja-keys from pre-bundling so our virtual module plugin can handle the CSS import.
      // Exclude chokidar/fsevents: chokidar v3 leaks in via @vt/graph-state -> @vt/graph-model
      // barrel re-exports. rendererNodeShimPlugin shims them at resolve time during dev and prod;
      // excluding them here prevents esbuild from pre-bundling them before the plugin can intercept.
      exclude: ['ninja-keys', 'fsevents', 'chokidar', '@vscode/ripgrep']
    },
    server: {
      port: parseInt(process.env.DEV_SERVER_PORT || '3000'),
      strictPort: false,
      host: devServerHost,
      hmr: false, // Disable HMR - use electron:watch script if you want hot reload
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
      rolldownOptions: {
        input: {
          main: path.resolve(webappDir, 'index.html')
        },
        // rendererNodeShimPlugin (above) resolves Node built-ins + Node-only packages to an
        // empty virtual module, so imports that leak in via `@vt/graph-state`->`@vt/graph-model`
        // barrel re-exports compile to no-ops instead of unresolvable bare specifiers.
        output: {
          codeSplitting: {
            groups: [
              {
                name: 'mermaid',
                test: /node_modules[\\/]mermaid[\\/]/
              }
            ]
          }
        }
      }
    },
    // Disable analytics in test builds
    define: isTestBuild ? {
      'import.meta.env.VITE_E2E_TEST': JSON.stringify('true')
    } : {}
  }
})
