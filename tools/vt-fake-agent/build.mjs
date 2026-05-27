import * as esbuild from 'esbuild'

// vt-fake-agent ships as a single bundled ESM JS file consumed by the
// agent-runtime spawn path as
//   node tools/vt-fake-agent/dist/index.js "$AGENT_PROMPT"
// (see packages/libraries/graph-model/src/pure/settings/settingsSchema.ts).
//
// Bundling lets us depend on workspace TypeScript packages like @vt/vt-rpc
// (which ships source-only). esbuild inlines the dependency graph so the
// resulting dist/ artifact has no runtime requirement on the workspace tree.
// Pattern mirrors @voicetree/cli's build.mjs.

await esbuild.build({
    entryPoints: ['src/index.ts'],
    outfile: 'dist/index.js',
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    banner: {
        // Some transitive CJS deps may use require() for Node built-ins.
        // esbuild's ESM __require shim throws for those — install a real
        // require via createRequire so any bundled CJS keeps working in
        // ESM output. Carried over from voicetree-cli's build.
        js: [
            'import {createRequire as __bundleCreateRequire} from "node:module";',
            'const require = __bundleCreateRequire(import.meta.url);',
        ].join('\n'),
    },
})
