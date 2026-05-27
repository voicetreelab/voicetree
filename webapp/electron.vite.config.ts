import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import wasm from 'vite-plugin-wasm'
import path from 'path'

// Per-pipeline build timing. Pair plugins: a `pre`-enforced one starts a per-id
// timer in transform(); a `post`-enforced one stops it. Sum of (post-pre) per id
// approximates the time other plugins spent transforming that file in this
// pipeline. Bucket by node_modules package to surface the heaviest deps.
// Wall-clock per pipeline comes from buildStart/buildEnd. Opt-in via
// VT_BUILD_TIMING=1 so normal builds stay quiet. Stderr-only output.
type TimingState = { pipelineStart: bigint; perId: Map<string, bigint>; perPkg: Map<string, bigint> }
type TimedHook =
  | 'resolveId'
  | 'load'
  | 'transform'
  | 'generateBundle'
  | 'renderChunk'
  | 'writeBundle'
  | 'closeBundle'
type HookTiming = { total: bigint; count: number; details: Map<string, bigint> }
type HookPhase = { firstStart: bigint; lastEnd: bigint; total: bigint; count: number }
type HookFunction = (this: unknown, ...args: unknown[]) => unknown
type BuildMark = { label: string; at: bigint }
const packageOf = (id: string): string => {
  const idx = id.lastIndexOf('/node_modules/')
  if (idx < 0) return '(app)'
  const tail = id.slice(idx + '/node_modules/'.length)
  const parts = tail.split('/')
  return parts[0].startsWith('@') && parts.length > 1 ? `${parts[0]}/${parts[1]}` : parts[0]
}
const fmtMs = (ns: bigint) => `${(Number(ns) / 1e6).toFixed(0)}ms`
const addHookTiming = (
  timings: Map<string, HookTiming>,
  phases: Map<TimedHook, HookPhase>,
  hook: TimedHook,
  pluginName: string,
  detail: string | undefined,
  start: bigint,
  end: bigint,
  elapsed: bigint
) => {
  const phase = phases.get(hook) ?? { firstStart: start, lastEnd: end, total: 0n, count: 0 }
  if (start < phase.firstStart) phase.firstStart = start
  if (end > phase.lastEnd) phase.lastEnd = end
  phase.total += elapsed
  phase.count += 1
  phases.set(hook, phase)

  const key = `${hook}:${pluginName}`
  const timing = timings.get(key) ?? { total: 0n, count: 0, details: new Map<string, bigint>() }
  timing.total += elapsed
  timing.count += 1
  if (detail) {
    timing.details.set(detail, (timing.details.get(detail) ?? 0n) + elapsed)
  }
  timings.set(key, timing)
}

const hookDetail = (hook: TimedHook, args: unknown[]): string | undefined => {
  const first = args[0]
  if ((hook === 'resolveId' || hook === 'load' || hook === 'transform') && typeof first === 'string') {
    if (hook === 'transform' && typeof args[1] === 'string') return args[1]
    return first
  }
  if (hook === 'renderChunk') {
    const chunk = args[1] as { fileName?: string; name?: string } | undefined
    return chunk?.fileName ?? chunk?.name
  }
  return undefined
}

const summarizeDetails = (details: Map<string, bigint>) =>
  [...details.entries()]
    .sort((a, b) => Number(b[1] - a[1]))
    .slice(0, 5)
    .map(([detail, ns]) => `      ${detail.slice(0, 90).padEnd(90)} ${fmtMs(ns)}`)
    .join('\n')

const hookHandler = (hookValue: unknown): HookFunction | undefined => {
  if (typeof hookValue === 'function') return hookValue
  if (hookValue && typeof hookValue === 'object' && typeof (hookValue as { handler?: unknown }).handler === 'function') {
    return (hookValue as { handler: HookFunction }).handler
  }
  return undefined
}

const withHookHandler = (hookValue: unknown, handler: HookFunction) => {
  if (typeof hookValue === 'function') return handler
  return { ...(hookValue as object), handler }
}

const rollupHookTimingPlugin = (label: string): Plugin => {
  const enabled = process.env.VT_BUILD_TIMING === '1'
  const hooks: TimedHook[] = ['resolveId', 'load', 'transform', 'generateBundle', 'renderChunk', 'writeBundle', 'closeBundle']
  const timings = new Map<string, HookTiming>()
  const phases = new Map<TimedHook, HookPhase>()
  const marks: BuildMark[] = []
  const mark = (markLabel: string) => {
    if (enabled) marks.push({ label: markLabel, at: process.hrtime.bigint() })
  }
  return {
    name: `vt-rollup-hook-timing-${label}`,
    enforce: 'pre',
    buildStart() {
      timings.clear()
      phases.clear()
      marks.length = 0
      mark('buildStart')
    },
    renderStart() {
      mark('renderStart')
    },
    generateBundle() {
      mark('generateBundle')
    },
    writeBundle() {
      mark('writeBundle')
    },
    configResolved(config) {
      if (!enabled) return
      for (const plugin of config.plugins) {
        if (plugin.name.startsWith('vt-rollup-hook-timing-')) continue
        for (const hook of hooks) {
          const originalValue = plugin[hook]
          const originalHandler = hookHandler(originalValue)
          if (!originalHandler) continue
          plugin[hook] = withHookHandler(originalValue, function timedRollupHook(this: unknown, ...args: unknown[]) {
            const start = process.hrtime.bigint()
            const record = () => {
              const end = process.hrtime.bigint()
              addHookTiming(timings, phases, hook, plugin.name, hookDetail(hook, args), start, end, end - start)
            }
            try {
              const result = originalHandler.apply(this, args)
              if (result && typeof (result as Promise<unknown>).then === 'function') {
                return (result as Promise<unknown>).finally(record)
              }
              record()
              return result
            } catch (error) {
              record()
              throw error
            }
          }) as never
        }
      }
    },
    closeBundle() {
      mark('closeBundle')
      if (!enabled || timings.size === 0) return
      const markLines = marks
        .map((current, idx) => {
          const previous = marks[idx - 1]
          const sinceStart = current.at - marks[0].at
          const sincePrevious = previous ? current.at - previous.at : 0n
          return `    ${current.label.padEnd(18)} +${fmtMs(sincePrevious).padStart(8)} since-start=${fmtMs(sinceStart).padStart(8)}`
        })
        .join('\n')
      const phaseLines = [...phases.entries()]
        .sort((a, b) => Number((b[1].lastEnd - b[1].firstStart) - (a[1].lastEnd - a[1].firstStart)))
        .map(([hook, phase]) => {
          const span = phase.lastEnd - phase.firstStart
          return `    ${hook.padEnd(16)} span=${fmtMs(span).padStart(8)} cumulative=${fmtMs(phase.total).padStart(8)} ${String(phase.count).padStart(6)} calls`
        })
        .join('\n')
      const lines = [...timings.entries()]
        .sort((a, b) => Number(b[1].total - a[1].total))
        .slice(0, 40)
        .map(([key, timing]) => {
          const details = summarizeDetails(timing.details)
          return `    ${key.padEnd(62)} ${fmtMs(timing.total).padStart(8)} ${String(timing.count).padStart(5)} calls${
            details ? `\n${details}` : ''
          }`
        })
        .join('\n')
      process.stderr.write(
        `\n[vt-build-timing] ${label} rollup build marks\n${markLines}\n` +
        `\n[vt-build-timing] ${label} rollup hook phases\n${phaseLines}\n` +
          `\n[vt-build-timing] ${label} rollup hooks (top cumulative plugin hook time)\n${lines}\n`
      )
    }
  }
}

const buildTimingPlugins = (label: string) => {
  const enabled = process.env.VT_BUILD_TIMING === '1'
  const state: TimingState = { pipelineStart: 0n, perId: new Map(), perPkg: new Map() }
  const pre = {
    name: `vt-build-timing-${label}-pre`,
    enforce: 'pre' as const,
    buildStart() {
      if (!enabled) return
      state.pipelineStart = process.hrtime.bigint()
      state.perId.clear()
      state.perPkg.clear()
    },
    transform(_code: string, id: string) {
      if (!enabled) return null
      state.perId.set(id, process.hrtime.bigint())
      return null
    },
  }
  const post = {
    name: `vt-build-timing-${label}-post`,
    enforce: 'post' as const,
    transform(_code: string, id: string) {
      if (!enabled) return null
      const start = state.perId.get(id)
      if (start === undefined) return null
      const dt = process.hrtime.bigint() - start
      state.perPkg.set(packageOf(id), (state.perPkg.get(packageOf(id)) ?? 0n) + dt)
      return null
    },
    buildEnd() {
      if (!enabled) return
      const total = process.hrtime.bigint() - state.pipelineStart
      const top = [...state.perPkg.entries()]
        .sort((a, b) => Number(b[1] - a[1]))
        .slice(0, 10)
        .map(([pkg, ns]) => `    ${pkg.padEnd(40)} ${fmtMs(ns)}`)
        .join('\n')
      process.stderr.write(`\n[vt-build-timing] ${label} pipeline: ${fmtMs(total)}\n${top}\n`)
    },
  }
  return [pre, post]
}

// Detect if building for tests (npm run test:*, build:test, etc.)
const npmScript = process.env.npm_lifecycle_event || ''
const isTestBuild = npmScript.startsWith('test') || npmScript === 'build:test'
const devServerHost: true | string = process.env.DEV_SERVER_HOST || true
const ELECTRON_VITE_EXTERNALIZE_EXCLUDE = [
  '@vt/graph-tools',
  '@vt/graph-model',
  '@vt/app-config',
  // ESM-only packages. Rolldown's CJS output preserves external imports as
  // require(), which returns a module namespace for these dependencies.
  'fix-path',
  'rbush',
]
const MAIN_RUNTIME_EXTERNALS: string[] = [
  'electron-trackpad-detect',
  '@huggingface/transformers',
  'onnxruntime-node',
  'onnxruntime-common',
  'onnxruntime-web',
  'chokidar',
  'fsevents',
  'bufferutil',
  'utf-8-validate',
  // Express + middleware tree. Reachable from main.ts via @vt/vt-daemon +
  // @vt/graph-tools/node, both of which are in webapp devDependencies (not
  // dependencies), so electron-vite's externalizeDepsPlugin doesn't externalize
  // them and pulls express inline. Express is Node-only; main runs in Node so
  // require()-ing it from node_modules at runtime is fine.
  'express',
  'body-parser',
  'qs',
  'iconv-lite',
  'ws',
  'serve-static',
  'router',
  'finalhandler',
  'send',
  'mime-types',
  'mime-db',
  'type-is',
  'accepts',
  'http-errors',
]

// externalizeDepsPlugin resolves bundled packages (@vt/graph-model, @vt/graph-tools) to absolute
// paths before the bundler sees them, so a bare-string entry in `external` fails to match resolved
// transitive deps. Rolldown's `external` accepts only string | RegExp (Functions are rejected),
// so we emit both the bare specifier (for unresolved imports) and a /node_modules/<dep>(/|$) regex
// (for resolved absolute paths) per dep, plus a regex for .node native binaries.
const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const MAIN_EXTERNAL_PATTERNS: (string | RegExp)[] = [
  /\.node$/,
  ...MAIN_RUNTIME_EXTERNALS,
  ...MAIN_RUNTIME_EXTERNALS.map(dep => new RegExp(`/node_modules/${escapeRegExp(dep)}(/|$)`)),
]

// @vt/graph-model (bundled inline) depends on chokidar v3, which requires fsevents natively.
// The @rollup/plugin-commonjs resolver runs before rollupOptions.external is consulted, so we
// need a pre-enforce resolveId hook to intercept native .node files before commonjs touches them.
const PRE_EXTERNAL_NATIVE_DEPS = new Set(['fsevents', 'chokidar', 'bufferutil', 'utf-8-validate'])
const externalNativePlugin = {
  name: 'externalize-native-modules',
  enforce: 'pre' as const,
  resolveId(id: string) {
    if (id.endsWith('.node') || PRE_EXTERNAL_NATIVE_DEPS.has(id)) {
      return { id, external: true }
    }
  }
}

// Express + middleware tree is reachable from main.ts via @vt/vt-daemon +
// @vt/graph-tools/node. Both are in webapp devDependencies (not deps), so
// electron-vite's externalizeDepsPlugin doesn't externalize them and pulls
// express inline. Marking via rollupOptions.external is too late — @rollup/plugin-commonjs
// has already converted the require()s. Intercept at pre-resolveId and
// short-circuit to external. Main runs in Node so require()-ing from node_modules
// at runtime is fine; express is in the root node_modules of the monorepo.
const PRE_EXTERNAL_MAIN_DEPS = new Set([
  'express',
  'body-parser',
  'qs',
  'iconv-lite',
  'ws',
  'serve-static',
  'router',
  'finalhandler',
  'send',
  'mime-types',
  'mime-db',
  'type-is',
  'accepts',
  'http-errors',
  'on-finished',
  'parseurl',
  'merge-descriptors',
  'content-disposition',
  'content-type',
  'cookie',
  'cookie-signature',
  'depd',
  'destroy',
  'ee-first',
  'encodeurl',
  'escape-html',
  'etag',
  'fresh',
  'forwarded',
  'inherits',
  'ipaddr.js',
  'media-typer',
  'methods',
  'negotiator',
  'object-inspect',
  'path-to-regexp',
  'proxy-addr',
  'range-parser',
  'raw-body',
  'safe-buffer',
  'safer-buffer',
  'setprototypeof',
  'statuses',
  'toidentifier',
  'unpipe',
  'utils-merge',
  'vary',
])
const externalMainDepsPlugin = {
  name: 'externalize-main-deps',
  enforce: 'pre' as const,
  resolveId(id: string) {
    if (PRE_EXTERNAL_MAIN_DEPS.has(id)) {
      return { id, external: true }
    }
    // Subpath imports like 'body-parser/lib/types/json'
    const firstSeg = id.split('/')[0]
    if (PRE_EXTERNAL_MAIN_DEPS.has(firstSeg) && !id.startsWith('.') && !id.startsWith('/')) {
      return { id, external: true }
    }
  }
}

const graphStateFixtureFilenameShimPlugin = {
  name: 'graph-state-fixture-filename-shim',
  enforce: 'pre' as const,
  transform(code: string, id: string) {
    if (!id.includes('/packages/libraries/graph-state/src/fixtures.ts')) {
      return null
    }

    return {
      code: code
        .replace('const __filename = fileURLToPath(import.meta.url)', 'const graphStateFixturesFilename = fileURLToPath(import.meta.url)')
        .replace('const __dirname = path.dirname(__filename)', 'const graphStateFixturesDirname = path.dirname(graphStateFixturesFilename)')
        .replaceAll('__dirname', 'graphStateFixturesDirname'),
      moduleType: 'js'
    }
  }
}

const mainCommonjsPackageBoundaryPlugin = {
  name: 'main-commonjs-package-boundary',
  apply: 'build' as const,
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'package.json',
      source: '{ "type": "commonjs" }\n'
    })
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
    return {
      code: `
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
// node:module — Rollup needs a named export for createRequire to resolve.
// The renderer never calls these code paths (the agent-runtime emulator
// that uses this is now reachable only via subpath imports the renderer
// doesn't take), but transitive imports may still surface; the Proxy keeps
// module-init silent if it ever fires.
export const createRequire = () => () => new Proxy({}, { get: () => function stub(){} });
// crypto
export const randomUUID = () => '00000000-0000-0000-0000-000000000000';
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
`,
      moduleType: 'js'
    }
  }
}

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
    ],
    logLevel: 'error',
    resolve: {
      alias: [
        { find: /^@vt\/graph-model$/, replacement: path.resolve(__dirname, '../packages/libraries/graph-model/src/index.ts') },
        { find: /^@vt\/graph-model\/(.+)$/, replacement: path.resolve(__dirname, '../packages/libraries/graph-model/src/$1') },
        { find: /^@vt\/app-config$/, replacement: path.resolve(__dirname, '../packages/libraries/app-config/src/index.ts') },
        { find: '@vt/app-config/settings', replacement: path.resolve(__dirname, '../packages/libraries/app-config/src/settings/settings_IO.ts') },
        { find: '@vt/app-config/vault-config', replacement: path.resolve(__dirname, '../packages/libraries/app-config/src/vault-config/voicetree-config-io.ts') },
        { find: '@vt/app-config/project', replacement: path.resolve(__dirname, '../packages/libraries/app-config/src/project/index.ts') },
        { find: '@', replacement: path.resolve(__dirname, './src') }
      ]
    },
    build: {
      outDir: 'dist-electron/main',
      logLevel: 'error',
      externalizeDeps: { exclude: ELECTRON_VITE_EXTERNALIZE_EXCLUDE },
      rolldownOptions: {
        input: {
          index: path.resolve(__dirname, 'src/shell/edge/main/runtime/electron/app/main.ts')
        },
        external: MAIN_EXTERNAL_PATTERNS,
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
      alias: [
        { find: /^@vt\/graph-model$/, replacement: path.resolve(__dirname, '../packages/libraries/graph-model/src/index.ts') },
        { find: /^@vt\/graph-model\/(.+)$/, replacement: path.resolve(__dirname, '../packages/libraries/graph-model/src/$1') },
        { find: /^@vt\/app-config$/, replacement: path.resolve(__dirname, '../packages/libraries/app-config/src/index.ts') },
        { find: '@vt/app-config/settings', replacement: path.resolve(__dirname, '../packages/libraries/app-config/src/settings/settings_IO.ts') },
        { find: '@vt/app-config/vault-config', replacement: path.resolve(__dirname, '../packages/libraries/app-config/src/vault-config/voicetree-config-io.ts') },
        { find: '@vt/app-config/project', replacement: path.resolve(__dirname, '../packages/libraries/app-config/src/project/index.ts') },
        { find: '@', replacement: path.resolve(__dirname, './src') }
      ]
    },
    build: {
      outDir: 'dist-electron/preload',
      logLevel: 'error',
      externalizeDeps: { exclude: ELECTRON_VITE_EXTERNALIZE_EXCLUDE },
      rolldownOptions: {
        input: {
          index: path.resolve(__dirname, 'src/shell/edge/main/runtime/electron/app/preload.ts')
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
            return {
              code: 'export const styles = "";',
              moduleType: 'js'
            }
          }
        }
      },
      react(),
      tailwindcss(),
      wasm()
    ],
    base: './',
    resolve: {
      alias: [
        { find: /^@vt\/graph-state$/, replacement: path.resolve(__dirname, '../packages/libraries/graph-state/src/index.ts') },
        { find: /^@vt\/graph-state\/(.+)$/, replacement: path.resolve(__dirname, '../packages/libraries/graph-state/src/$1') },
        { find: /^@vt\/graph-model$/, replacement: path.resolve(__dirname, '../packages/libraries/graph-model/src/index.ts') },
        { find: /^@vt\/graph-model\/(.+)$/, replacement: path.resolve(__dirname, '../packages/libraries/graph-model/src/$1') },
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
      logLevel: 'error',
      rolldownOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html')
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
