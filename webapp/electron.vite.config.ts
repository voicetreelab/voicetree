import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'
import path from 'path'

// Detect if building for tests (npm run test:*, build:test, etc.)
const npmScript = process.env.npm_lifecycle_event || ''
const isTestBuild = npmScript.startsWith('test') || npmScript === 'build:test'
const MAIN_RUNTIME_EXTERNALS: string[] = [
  'electron-trackpad-detect',
  '@huggingface/transformers',
  'onnxruntime-node',
  'onnxruntime-common',
  'onnxruntime-web',
  'better-sqlite3',
  'sqlite-vec',
  'chokidar',
  'fsevents',
]

// externalizeDepsPlugin resolves bundled packages (@vt/graph-model, @vt/graph-tools) to absolute
// paths before rollup sees them, so string matching in external[] fails for their transitive deps.
// Use a function that matches both raw specifiers and resolved absolute paths, and catches .node
// native binaries that rollup cannot parse.
const isMainExternal = (id: string): boolean => {
  if (id.endsWith('.node')) return true
  return MAIN_RUNTIME_EXTERNALS.some(
    dep => id === dep || id.includes(`/node_modules/${dep}/`) || id.includes(`/node_modules/${dep}`)
  )
}

// @vt/graph-model (bundled inline) depends on chokidar v3, which requires fsevents natively.
// The @rollup/plugin-commonjs resolver runs before rollupOptions.external is consulted, so we
// need a pre-enforce resolveId hook to intercept native .node files before commonjs touches them.
const externalNativePlugin = {
  name: 'externalize-native-modules',
  enforce: 'pre' as const,
  resolveId(id: string) {
    if (id.endsWith('.node') || id === 'fsevents') {
      return { id, external: true }
    }
  }
}

// Renderer-only: Node.js built-ins and Node-only packages leak into the bundle via
// `@vt/graph-state` -> `@vt/graph-model` barrel re-exports (apply/*.ts, fixtures.ts).
// Renderer code paths never *call* these at runtime, but the import declarations persist in
// the output. Browsers cannot resolve bare specifiers like "fs" -> blank renderer.
// Previously we marked them `external`, but rollup preserves those imports verbatim.
// Instead, resolve them to a single empty-shim virtual module so imports become no-ops.
const RENDERER_NODE_SHIM_ID = '\0voicetree:renderer-node-shim'
const NODE_BUILTINS = new Set([
  'assert', 'buffer', 'child_process', 'cluster', 'crypto', 'dgram', 'dns', 'domain',
  'events', 'fs', 'fs/promises', 'http', 'http2', 'https', 'module', 'net', 'os',
  'path', 'punycode', 'querystring', 'readline', 'repl', 'stream', 'stream/promises',
  'string_decoder', 'sys', 'timers', 'tls', 'tty', 'url', 'util', 'v8', 'vm', 'wasi',
  'worker_threads', 'zlib',
])
const NODE_SHIM_PACKAGES = new Set(['@vscode/ripgrep', 'chokidar', 'fsevents'])
const rendererNodeShimPlugin = {
  name: 'renderer-node-shim',
  enforce: 'pre' as const,
  resolveId(id: string) {
    if (id.startsWith('node:')) return RENDERER_NODE_SHIM_ID
    if (NODE_BUILTINS.has(id)) return RENDERER_NODE_SHIM_ID
    if (NODE_BUILTINS.has(id.split('/')[0]) && id.startsWith('fs/')) return RENDERER_NODE_SHIM_ID
    if (NODE_SHIM_PACKAGES.has(id)) return RENDERER_NODE_SHIM_ID
    return null
  },
  load(id: string) {
    if (id !== RENDERER_NODE_SHIM_ID) return null
    return `
const noop = () => {};
// path.posix shim — used by @vt/graph-state/project.ts (labelForFolder, labelForNode).
// Must be defined before the proxy handler so the handler can return it.
const posix = {
  basename: (p) => { if (typeof p !== 'string') return ''; const s = p.replace(/\\/$/, '').split('/'); return s[s.length - 1] || ''; },
  dirname: (p) => { if (typeof p !== 'string') return '.'; const i = p.replace(/\\/$/, '').lastIndexOf('/'); return i <= 0 ? '/' : p.slice(0, i); },
  extname: (p) => { if (typeof p !== 'string') return ''; const m = /\\.[^./]+$/.exec(p); return m ? m[0] : ''; },
  join: (...args) => args.filter(Boolean).join('/'),
  resolve: (...args) => args.filter(Boolean).join('/'),
  relative: (from, to) => typeof to === 'string' ? to : '',
  normalize: (p) => typeof p === 'string' ? p : '',
  sep: '/',
  delimiter: ':',
};
const handler = {
  get(target, prop) {
    if (prop === '__esModule') return true;
    if (prop === 'default') return proxy;
    if (prop === 'promises') return proxy;
    if (prop === 'posix') return posix;
    if (typeof prop === 'symbol') return undefined;
    return target[prop] !== undefined ? target[prop] : noop;
  }
};
const proxy = new Proxy({}, handler);
export default proxy;
export { posix };
// fs / fs/promises
export const promises = proxy;
export const access = noop;
export const mkdir = noop;
export const stat = noop;
export const readFile = noop;
export const writeFile = noop;
export const readdir = noop;
export const rm = noop;
export const rename = noop;
export const unlink = noop;
export const copyFile = noop;
export const open = noop;
export const mkdtemp = noop;
export const watch = () => ({ on: noop, close: noop, add: noop });
export const existsSync = () => false;
export const readFileSync = () => '';
export const writeFileSync = noop;
export const readdirSync = () => [];
export const statSync = noop;
export const mkdirSync = noop;
export const mkdtempSync = () => '';
export const rmSync = noop;
export const renameSync = noop;
export const cpSync = noop;
export const appendFileSync = noop;
// path
export const join = (...args) => args.filter(Boolean).join('/');
export const resolve = (...args) => args.filter(Boolean).join('/');
export const dirname = (p) => typeof p === 'string' ? p.replace(/\\/[^/]*$/, '') : '';
export const basename = (p) => typeof p === 'string' ? p.split('/').pop() : '';
export const extname = (p) => {
  if (typeof p !== 'string') return '';
  const m = /\\.[^./]+$/.exec(p);
  return m ? m[0] : '';
};
export const isAbsolute = (p) => typeof p === 'string' && p.startsWith('/');
export const relative = (from, to) => typeof to === 'string' ? to : '';
export const normalize = (p) => typeof p === 'string' ? p : '';
export const sep = '/';
export const delimiter = ':';
// url
export const fileURLToPath = (u) => typeof u === 'string' ? u : '';
export const pathToFileURL = (p) => ({ href: typeof p === 'string' ? p : '' });
export const URL = globalThis.URL;
export const URLSearchParams = globalThis.URLSearchParams;
// os
export const tmpdir = () => '/tmp';
export const homedir = () => '/';
export const platform = () => 'browser';
export const arch = () => 'browser';
// child_process
export const spawn = () => ({ stdout: { on: noop }, stderr: { on: noop }, on: () => {} });
export const execFileSync = () => '';
export const fork = noop;
// events / stream / util / buffer
export class EventEmitter { on(){} off(){} emit(){} once(){} removeListener(){} }
export const promisify = (fn) => fn;
export const inspect = (x) => String(x);
export const format = (...a) => a.join(' ');
export const Readable = class {};
export const Writable = class {};
export const Duplex = class {};
export const Transform = class {};
export const Buffer = globalThis.Buffer || class { static from(){ return new Uint8Array(); } };
// @vscode/ripgrep
export const rgPath = '';
`
  }
}

/**
 * Electron-Vite configuration
 * This is the PRIMARY config for development (npm run electron)
 */
export default defineConfig({
  main: {
    // Configuration for electron main process
    plugins: [externalNativePlugin, externalizeDepsPlugin({ exclude: ['@vt/graph-tools', '@vt/graph-model'] })],
    logLevel: 'error',
    resolve: {
      alias: [
        { find: /^@vt\/graph-model$/, replacement: path.resolve(__dirname, '../packages/graph-model/src/index.ts') },
        { find: /^@vt\/graph-model\/(.+)$/, replacement: path.resolve(__dirname, '../packages/graph-model/src/$1') },
        { find: '@', replacement: path.resolve(__dirname, './src') }
      ]
    },
    build: {
      outDir: 'dist-electron/main',
      logLevel: 'error',
      rollupOptions: {
        input: {
          index: path.resolve(__dirname, 'src/shell/edge/main/electron/main.ts')
        },
        external: isMainExternal
      }
    }
  },
  preload: {
    // Configuration for preload script
    plugins: [externalNativePlugin, externalizeDepsPlugin({ exclude: ['@vt/graph-tools', '@vt/graph-model'] })],
    logLevel: 'error',
    resolve: {
      alias: [
        { find: /^@vt\/graph-model$/, replacement: path.resolve(__dirname, '../packages/graph-model/src/index.ts') },
        { find: /^@vt\/graph-model\/(.+)$/, replacement: path.resolve(__dirname, '../packages/graph-model/src/$1') },
        { find: '@', replacement: path.resolve(__dirname, './src') }
      ]
    },
    build: {
      outDir: 'dist-electron/preload',
      logLevel: 'error',
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
      rendererNodeShimPlugin,
      externalNativePlugin,
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
      alias: [
        { find: /^@vt\/graph-state$/, replacement: path.resolve(__dirname, '../packages/graph-state/src/index.ts') },
        { find: /^@vt\/graph-state\/(.+)$/, replacement: path.resolve(__dirname, '../packages/graph-state/src/$1') },
        { find: /^@vt\/graph-model$/, replacement: path.resolve(__dirname, '../packages/graph-model/src/index.ts') },
        { find: /^@vt\/graph-model\/(.+)$/, replacement: path.resolve(__dirname, '../packages/graph-model/src/$1') },
        { find: '@', replacement: path.resolve(__dirname, './src') },
        { find: '@wasm', replacement: path.resolve(__dirname, './tidy/wasm_dist') },
        // Alias CSS imports from @material to prevent import errors
        { find: '@material/mwc-icon/mwc-icon-host.css', replacement: path.resolve(__dirname, 'src/utils/empty-css-export.ts') }
      ]
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
      host: true,
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
      logLevel: 'error',
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html')
        },
        // rendererNodeShimPlugin (above) resolves Node built-ins + Node-only packages to an
        // empty virtual module, so imports that leak in via `@vt/graph-state`->`@vt/graph-model`
        // barrel re-exports compile to no-ops instead of unresolvable bare specifiers.
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
    },
    // Disable analytics in test builds
    define: isTestBuild ? {
      'import.meta.env.VITE_E2E_TEST': JSON.stringify('true')
    } : {}
  }
})
