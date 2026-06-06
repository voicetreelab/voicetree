import * as esbuild from 'esbuild'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../../..')
const perfProbePath = resolve(repoRoot, 'packages/libraries/perf-analysis/src/perf-probe.mjs')

// The packaged Electron app spawns two Node daemons as separate child
// processes: vtd (this package) and vt-graphd (its sibling, spawned by vtd
// over RPC). Both must run as plain Node — never under the Electron binary
// (node:sqlite ABI; see @vt/graph-db-client resolveDaemonRuntimeCommand) — and
// neither ships its TypeScript source in production. We bundle BOTH here, as
// sibling .mjs files in dist/, so that:
//   - @vt/vt-daemon-client's resolveCommand finds dist/vtd.mjs, and
//   - @vt/graph-db-client's defaultSiblingDaemonPath finds vt-graphd.mjs next
//     to vtd.mjs at runtime (import.meta.url of the bundled client resolves to
//     the directory the .mjs is shipped in).
// This mirrors @voicetree/cli's build, which co-locates the same two bundles
// for the published CLI tarball.
const sharedExternals = [
  // Native file-watcher mac binding. chokidar try/catches a missing fsevents
  // and falls back to fs.watch, so leaving it external (and absent in the
  // packaged app, where fsevents is not shipped) is safe. chokidar ITSELF is
  // bundled inline — unlike the CLI/graphd builds, the Electron app does not
  // ship chokidar in node_modules, so it cannot stay external here.
  'fsevents',
  // @vscode/ripgrep uses __dirname to locate its native binary, which breaks
  // when bundled into ESM. Keep it external; it is asar-unpacked and resolves
  // at runtime via the node_modules walk-up from the unpacked bundle.
  '@vscode/ripgrep',
  // @pyroscope/nodejs loads @datadog/pprof native bindings via __dirname.
  // Only imported when a profiling endpoint env var is set (never in the
  // shipped app), so leaving it external + absent is safe.
  '@pyroscope/nodejs',
  // node-pty is a native (N-API) addon loaded lazily by the tmux-attach relay.
  // It is asar-unpacked and resolves at runtime via the node_modules walk-up.
  'node-pty',
]

const sharedBanner = {
  js: [
    // Some transitive CJS deps use require() for Node built-ins. esbuild's ESM
    // __require shim throws for those — install a real require via
    // createRequire so bundled CJS code keeps working in ESM output.
    'import { createRequire as __bundleCreateRequire } from "node:module";',
    'const require = __bundleCreateRequire(import.meta.url);',
  ].join('\n'),
}

const perfAnalysisPlugin = {
  name: 'workspace-perf-analysis',
  setup(build) {
    build.onResolve({ filter: /^@vt\/perf-analysis\/perf-probe$/ }, () => ({
      path: perfProbePath,
    }))
  },
}

async function bundle(entryPoints, outfile) {
  await esbuild.build({
    entryPoints,
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: sharedExternals,
    plugins: [perfAnalysisPlugin],
    banner: sharedBanner,
  })
}

await bundle(['bin/vtd.ts'], 'dist/vtd.mjs')
await bundle(['../graph-db-server/bin/vt-graphd.ts'], 'dist/vt-graphd.mjs')

// esbuild preserves the entrypoint's original shebang
// (#!/usr/bin/env -S node --import tsx). Replace it with a clean shebang so the
// compiled bundle runs under a plain Node runtime with no tsx loader.
async function rewriteShebang(outPath) {
  const src = await readFile(outPath, 'utf8')
  const lines = src.split('\n')
  while (lines.length > 0 && lines[0].startsWith('#!')) {
    lines.shift()
  }
  await writeFile(outPath, '#!/usr/bin/env node\n' + lines.join('\n'))
}

await rewriteShebang('dist/vtd.mjs')
await rewriteShebang('dist/vt-graphd.mjs')
