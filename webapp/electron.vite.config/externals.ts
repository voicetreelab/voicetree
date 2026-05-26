export const ELECTRON_VITE_EXTERNALIZE_EXCLUDE = [
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
  // Express + middleware tree. Reachable from main.ts via @vt/voicetree-mcp +
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
// paths before rollup sees them, so string matching in external[] fails for their transitive deps.
// Use a function that matches both raw specifiers and resolved absolute paths, and catches .node
// native binaries that rollup cannot parse.
export const isMainExternal = (id: string): boolean => {
  if (id.endsWith('.node')) return true
  return MAIN_RUNTIME_EXTERNALS.some(
    dep => id === dep || id.includes(`/node_modules/${dep}/`) || id.includes(`/node_modules/${dep}`)
  )
}

// @vt/graph-model (bundled inline) depends on chokidar v3, which requires fsevents natively.
// The @rollup/plugin-commonjs resolver runs before rollupOptions.external is consulted, so we
// need a pre-enforce resolveId hook to intercept native .node files before commonjs touches them.
const PRE_EXTERNAL_NATIVE_DEPS = new Set(['fsevents', 'chokidar', 'bufferutil', 'utf-8-validate'])
export const externalNativePlugin = {
  name: 'externalize-native-modules',
  enforce: 'pre' as const,
  resolveId(id: string) {
    if (id.endsWith('.node') || PRE_EXTERNAL_NATIVE_DEPS.has(id)) {
      return { id, external: true }
    }
  }
}

// Express + middleware tree is reachable from main.ts via @vt/voicetree-mcp +
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

export const externalMainDepsPlugin = {
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
