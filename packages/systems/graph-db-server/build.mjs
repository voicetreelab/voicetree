import * as esbuild from 'esbuild'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../../..')
const perfProbePath = resolve(repoRoot, 'packages/libraries/perf-analysis/src/perf-probe.mjs')

const DEFAULT_OUTFILE = resolve(__dirname, 'dist/vt-graphd.mjs')

/**
 * Bundle `bin/vt-graphd.ts` into a single self-contained ESM file runnable by a
 * standalone Node ≥22 (`node:sqlite`). The entrypoint is the daemon the Electron
 * app and the published CLI both spawn.
 *
 * `outfile` lets callers redirect the bundle — the Electron build emits it into
 * `webapp/dist-electron/main/vt-graphd.mjs` so the runtime resolver's sibling
 * lookup finds it in the packaged app (see graph-db-client autoLaunch/runtime).
 * All input paths are resolved from this module's directory, so the bundle is
 * identical regardless of the caller's cwd.
 */
export async function bundleVtGraphd({ outfile = DEFAULT_OUTFILE } = {}) {
  const resolvedOutfile = resolve(outfile)

  await esbuild.build({
    absWorkingDir: __dirname,
    entryPoints: [resolve(__dirname, 'bin/vt-graphd.ts')],
    outfile: resolvedOutfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: [
      'fsevents',
      'chokidar',
      // @vscode/ripgrep uses __dirname to locate its native binary, which
      // breaks when bundled into ESM. Keep it external so it resolves at runtime.
      '@vscode/ripgrep',
      // @pyroscope/nodejs loads @datadog/pprof native bindings via __dirname.
      // Bundling it into ESM breaks that lookup; leave the package boundary
      // intact so Node's CommonJS loader provides the expected runtime globals.
      '@pyroscope/nodejs',
    ],
    plugins: [
      {
        name: 'workspace-perf-analysis',
        setup(build) {
          build.onResolve({ filter: /^@vt\/perf-analysis\/perf-probe$/ }, () => ({
            path: perfProbePath,
          }))
        },
      },
    ],
    banner: {
      js: [
        // gray-matter and other CJS deps use require() for Node built-ins.
        // esbuild's ESM __require shim throws for those. Provide a real require
        // via createRequire so bundled CJS code works in ESM output.
        'import { createRequire as __bundleCreateRequire } from "node:module";',
        'const require = __bundleCreateRequire(import.meta.url);',
      ].join('\n'),
    },
  })

  // esbuild preserves the original source shebang (#!/usr/bin/env -S node --import tsx).
  // Replace it with a clean shebang for the compiled bundle.
  const src = await readFile(resolvedOutfile, 'utf8')
  const lines = src.split('\n')
  while (lines.length > 0 && lines[0].startsWith('#!')) {
    lines.shift()
  }
  await writeFile(resolvedOutfile, '#!/usr/bin/env node\n' + lines.join('\n'))

  return resolvedOutfile
}

// CLI entrypoint: `node build.mjs [outfile]` (used by `npm run build`).
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  const outfileArg = process.argv[2]
  await bundleVtGraphd(outfileArg ? { outfile: outfileArg } : {})
}
