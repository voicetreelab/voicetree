import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import {
  ELECTRON_VITE_EXTERNALIZE_EXCLUDE,
  MAIN_RUNTIME_EXTERNALS,
} from '../electron.vite.config/externals'

const require = createRequire(import.meta.url)
const webappPkg = require('../package.json') as {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

const PKG = '@vt/graph-db-client'

// Ratchet for the B1 entrypoint mechanism. graph-db-client's runtime resolver
// locates the spawned `vt-graphd.mjs` via a sibling lookup relative to its OWN
// `import.meta.url`. That resolves to `dist-electron/main/vt-graphd.mjs` (where
// bundleGraphdEntrypointPlugin emits it) ONLY because graph-db-client is bundled
// INLINE into electron-main — so its `import.meta.url` points at the main bundle.
// Externalizing it would move that URL into node_modules and silently break the
// packaged app's ability to find graphd. This test pins the two ways it could be
// externalized: a rolldown `external` entry, or being promoted to a production
// `dependency` (which electron-vite's externalizeDepsPlugin externalizes unless
// it is also in the exclude list).
describe('graphd entrypoint resolution invariant: graph-db-client stays inlined', () => {
  it('is not a rolldown main-runtime external', () => {
    expect(MAIN_RUNTIME_EXTERNALS).not.toContain(PKG)
  })

  it('is not externalized by externalizeDepsPlugin (dev-dep, or excluded if promoted)', () => {
    const isProdDependency = webappPkg.dependencies?.[PKG] !== undefined
    const isExcludedFromExternalizing = ELECTRON_VITE_EXTERNALIZE_EXCLUDE.includes(PKG)
    // Inlined when it is NOT a production dependency, or — if it ever becomes one —
    // it is force-excluded from externalizing. Either keeps it in the bundle.
    expect(!isProdDependency || isExcludedFromExternalizing).toBe(true)
  })
})
