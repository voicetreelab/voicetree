import type { Plugin } from 'vite'

export const graphStateFixtureFilenameShimPlugin = {
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

export const mainCommonjsPackageBoundaryPlugin: Plugin = {
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
export const rendererNodeShimPlugin = {
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

// Plugin to handle CSS imports from Lit Element components (ninja-keys -> @material/mwc-icon)
// Must run before tailwindcss plugin.
export const litCssPlugin = {
  name: 'lit-css',
  enforce: 'pre' as const,
  resolveId(source: string, importer?: string) {
    if (source.endsWith('.css') && importer && importer.includes('@material')) {
      return '\0' + source + '.js'
    }
  },
  load(id: string) {
    if (id.startsWith('\0') && id.includes('.css.js')) {
      return {
        code: 'export const styles = "";',
        moduleType: 'js'
      }
    }
  }
}
