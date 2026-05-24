import * as esbuild from 'esbuild'
import {readFile, writeFile} from 'node:fs/promises'

// The CLI ships as a single tarball containing two ESM bundles:
//   dist/voicetree-cli.js — the `vt` entrypoint (this package's bin)
//   dist/vt-graphd.mjs    — the graph daemon, spawned by the CLI at runtime
// Bundling the daemon here keeps `@voicetree/cli` as a one-package install:
// `@vt/graph-db-server` stays private and is not published separately.
const sharedExternals = [
    // Native file-watcher and its optional mac binding (used transitively
    // via @vt/graph-db-server's chokidar dependency).
    'fsevents',
    'chokidar',
    // @vscode/ripgrep uses __dirname to locate its native binary, which
    // breaks when bundled into ESM. Keep it external so it resolves at
    // runtime from the consumer's node_modules.
    '@vscode/ripgrep',
]

const sharedBanner = {
    js: [
        // Some transitive CJS deps use require() for Node built-ins. esbuild's
        // ESM __require shim throws for those — install a real require via
        // createRequire so bundled CJS code keeps working in ESM output.
        'import {createRequire as __bundleCreateRequire} from "node:module";',
        'const require = __bundleCreateRequire(import.meta.url);',
    ].join('\n'),
}

await esbuild.build({
    entryPoints: ['src/voicetree-cli.ts'],
    outfile: 'dist/voicetree-cli.js',
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: [
        ...sharedExternals,
        // @mermaid-js/parser ships with langium-generated workers that are
        // resolved relative to its own package directory. Keep it external so
        // the runtime resolves the package directly. (CLI-only; daemon does
        // not import it.)
        '@mermaid-js/parser',
    ],
    banner: sharedBanner,
})

await esbuild.build({
    entryPoints: ['../graph-db-server/bin/vt-graphd.ts'],
    outfile: 'dist/vt-graphd.mjs',
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: sharedExternals,
    banner: sharedBanner,
})

// esbuild preserves whatever shebang the entrypoint started with; replace each
// bundle's shebang with a clean `#!/usr/bin/env node` so they're directly
// executable.
async function rewriteShebang(outPath) {
    const src = await readFile(outPath, 'utf8')
    const lines = src.split('\n')
    while (lines.length > 0 && lines[0].startsWith('#!')) {
        lines.shift()
    }
    await writeFile(outPath, '#!/usr/bin/env node\n' + lines.join('\n'))
}

await rewriteShebang('dist/voicetree-cli.js')
await rewriteShebang('dist/vt-graphd.mjs')
