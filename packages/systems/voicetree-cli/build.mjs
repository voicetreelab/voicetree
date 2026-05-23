import * as esbuild from 'esbuild'
import {readFile, writeFile} from 'node:fs/promises'

await esbuild.build({
    entryPoints: ['src/voicetree-cli.ts'],
    outfile: 'dist/voicetree-cli.js',
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: [
        // Native file-watcher and its optional mac binding (used transitively
        // via @vt/graph-db-server's chokidar dependency).
        'fsevents',
        'chokidar',
        // @vscode/ripgrep uses __dirname to locate its native binary, which
        // breaks when bundled into ESM. Keep it external so it resolves at
        // runtime from the consumer's node_modules.
        '@vscode/ripgrep',
        // @mermaid-js/parser ships with langium-generated workers that are
        // resolved relative to its own package directory. Keep it external so
        // the runtime resolves the package directly.
        '@mermaid-js/parser',
    ],
    banner: {
        js: [
            // Some transitive CJS deps use require() for Node built-ins. esbuild's
            // ESM __require shim throws for those — install a real require via
            // createRequire so bundled CJS code keeps working in ESM output.
            'import {createRequire as __bundleCreateRequire} from "node:module";',
            'const require = __bundleCreateRequire(import.meta.url);',
        ].join('\n'),
    },
})

// esbuild preserves the original source's missing-or-shell shebang. Replace
// whatever it emitted with a clean node shebang so the bundle is directly
// executable via the published `bin` entry.
const outPath = 'dist/voicetree-cli.js'
const src = await readFile(outPath, 'utf8')
const lines = src.split('\n')
while (lines.length > 0 && lines[0].startsWith('#!')) {
    lines.shift()
}
await writeFile(outPath, '#!/usr/bin/env node\n' + lines.join('\n'))
