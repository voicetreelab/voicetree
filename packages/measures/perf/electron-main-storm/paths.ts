import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const require = createRequire(import.meta.url)

// measures/perf/electron-main-storm -> measures/perf -> measures -> packages -> repo root
export const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..')

export function resolveElectronBinary(): string {
    // `require('electron')` returns the absolute path to the platform binary
    // (e.g. .../node_modules/electron/dist/electron on Linux,
    //       .../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron on macOS).
    // Resolve from webapp/ so we get the workspace-local copy electron-vite uses.
    const electronModuleEntry = require.resolve('electron', {
        paths: [join(REPO_ROOT, 'webapp'), REPO_ROOT],
    })
    const binary = require(electronModuleEntry) as unknown
    if (typeof binary !== 'string') {
        throw new Error(`require('electron') did not return a string path (got ${typeof binary})`)
    }
    if (!existsSync(binary)) {
        throw new Error(
            `electron binary missing at ${binary}\n`
            + `The electron npm package was installed but its postinstall didn't download the\n`
            + `platform binary. Run \`npm rebuild electron\` (or reinstall) on this machine.`,
        )
    }
    return binary
}

export function resolveMainBundleEntry(): string {
    const entry = join(REPO_ROOT, 'webapp', 'dist-electron', 'main', 'index.js')
    if (!existsSync(entry)) {
        throw new Error(
            `Built electron main bundle missing at ${entry}.\n`
            + `Run \`npm --workspace webapp exec -- electron-vite build\` first.`,
        )
    }
    return entry
}

export function resolveFakeAgentEntrypoint(): { dir: string; entry: string } {
    const dir = join(REPO_ROOT, 'tools', 'vt-fake-agent')
    const entry = join(dir, 'src', 'index.ts')
    if (!existsSync(entry)) throw new Error(`vt-fake-agent entrypoint not found at ${entry}`)
    return { dir, entry }
}

export function resolveTsxImportPath(): string {
    return require.resolve('tsx')
}
