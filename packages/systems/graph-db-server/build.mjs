import * as esbuild from 'esbuild'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../../..')
const perfProbePath = resolve(repoRoot, 'packages/libraries/perf-analysis/src/perf-probe.mjs')

await esbuild.build({
  entryPoints: ['bin/vt-graphd.ts'],
  outfile: 'dist/vt-graphd.mjs',
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
const outPath = 'dist/vt-graphd.mjs'
const src = await readFile(outPath, 'utf8')
const lines = src.split('\n')
while (lines.length > 0 && lines[0].startsWith('#!')) {
  lines.shift()
}
await writeFile(outPath, '#!/usr/bin/env node\n' + lines.join('\n'))
