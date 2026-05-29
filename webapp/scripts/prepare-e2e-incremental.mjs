#!/usr/bin/env node
// Prepare the Electron app for the tier-1 e2e smoke test.
//
// In CI (and on any non-"fast" machine) this is a no-op wrapper that runs the
// full, unconditional build + native rebuild — identical to the historical
// `prepare:vite-build && prepare:native-rebuild`. CI MUST stay hermetic, so it
// never skips.
//
// On the fast remote devbox (many cores, or VT_DEV_ROLE=remote) it skips the
// ~8s build+rebuild when the artifacts are already current — the iterative
// Mac->remote loop rebuilds the same bundle every run otherwise. Freshness is
// mtime-based and CONSERVATIVE: any source newer than the built bundle forces a
// rebuild, so a skip never serves stale artifacts. Set VT_E2E_FORCE_BUILD=1 to
// always build.
import {execSync} from 'node:child_process'
import {existsSync, readFileSync, statSync, writeFileSync, readdirSync} from 'node:fs'
import {availableParallelism} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const WEBAPP = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = resolve(WEBAPP, '..')

const isCI = Boolean(process.env.CI)
const forceBuild = Boolean(process.env.VT_E2E_FORCE_BUILD)
const isFastRemote = process.env.VT_DEV_ROLE === 'remote' || availableParallelism() >= 32
// Skipping is only EVER allowed on the fast remote, never in CI, never forced.
const maySkip = isFastRemote && !isCI && !forceBuild

const run = (script) => execSync(`npm run ${script}`, {cwd: WEBAPP, stdio: 'inherit'})

// ---- vite build freshness -------------------------------------------------
// Built bundle entry. If any bundled source is newer, the build is stale.
const BUILD_OUTPUT = join(WEBAPP, 'dist-electron', 'main', 'index.js')
// Conservative input set: the webapp itself plus every workspace package src
// that the renderer/main can import. Over-inclusive on purpose — a false
// "stale" only costs a rebuild; a false "fresh" would serve a stale app.
const SOURCE_ROOTS = [
    join(WEBAPP, 'src'),
    join(WEBAPP, 'electron'),
    join(ROOT, 'packages', 'libraries'),
    join(ROOT, 'packages', 'systems'),
]
const SOURCE_FILE_RE = /\.(ts|tsx|js|jsx|mjs|cjs|json|html|css)$/
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'dist-electron', 'build', 'out', '.git'])

function newestMtimeMs(dir) {
    let newest = 0
    let entries
    try {
        entries = readdirSync(dir, {withFileTypes: true})
    } catch {
        return 0
    }
    for (const entry of entries) {
        if (entry.isDirectory()) {
            if (IGNORED_DIRS.has(entry.name)) continue
            newest = Math.max(newest, newestMtimeMs(join(dir, entry.name)))
        } else if (entry.isFile() && SOURCE_FILE_RE.test(entry.name)) {
            newest = Math.max(newest, statSync(join(dir, entry.name)).mtimeMs)
        }
    }
    return newest
}

function viteBuildFresh() {
    if (!existsSync(BUILD_OUTPUT)) return false
    const builtAt = statSync(BUILD_OUTPUT).mtimeMs
    return SOURCE_ROOTS.every(root => newestMtimeMs(root) <= builtAt)
}

// ---- native rebuild freshness ---------------------------------------------
// node-pty / electron-trackpad-detect must match the current Electron ABI.
// Marker records the Electron version they were last built against.
const ABI_MARKER = join(WEBAPP, 'dist-electron', '.native-abi')
const NODE_PTY_BUILD = join(ROOT, 'node_modules', 'node-pty', 'build', 'Release')
const electronVersion = JSON.parse(
    readFileSync(join(ROOT, 'node_modules', 'electron', 'package.json'), 'utf8'),
).version

function nativeRebuildFresh() {
    if (!existsSync(ABI_MARKER) || !existsSync(NODE_PTY_BUILD)) return false
    return readFileSync(ABI_MARKER, 'utf8').trim() === electronVersion
}

// ---- decide + run ---------------------------------------------------------
if (maySkip && viteBuildFresh()) {
    console.log('[prepare-e2e] vite build fresh — skipping (fast remote, no source newer than bundle)')
} else {
    if (maySkip) console.log('[prepare-e2e] vite build stale — rebuilding')
    run('prepare:vite-build')
}

if (maySkip && nativeRebuildFresh()) {
    console.log(`[prepare-e2e] native modules fresh for Electron ${electronVersion} — skipping`)
} else {
    run('prepare:native-rebuild')
    writeFileSync(ABI_MARKER, `${electronVersion}\n`)
}
