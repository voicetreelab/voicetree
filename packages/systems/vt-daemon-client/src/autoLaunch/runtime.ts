/**
 * Spawn-command resolver for the standalone vt-daemon (VTD).
 *
 * Sibling of `@vt/graph-db-client/autoLaunch/runtime.ts` (which resolves
 * vt-graphd's spawn command). The two live in their own packages because the
 * daemons take different argv shapes (graphd: `--project-root`, vtd:
 * `--project`). This resolver mirrors graphd's `resolveDefaultDaemonArgs`.
 *
 * Resolution order:
 *   1. If `override` (the BF-373 `EnsureVtDaemonOptions.bin`) is set, parse it
 *      as `<cmd> [args…]` and append `--project <project>`. Tests use this to
 *      point at `fake-vtd.mjs`.
 *   2. Else if `VT_DAEMON_BIN` env var is set, treat it the same way.
 *   3. Else locate the daemon entrypoint, preferring a built bundle over TS
 *      source (`resolveDefaultDaemonArgs`):
 *        a. A sibling `vtd.mjs` next to this module's runtime location. In the
 *           packaged Electron app this module is bundled into the main process
 *           bundle, so `import.meta.url` resolves to `dist-electron/main/` and
 *           the sibling is the shipped, asar-unpacked `vtd.mjs`. This is the
 *           ONLY branch that works in production — `@vt/vt-daemon` is bundled
 *           inline (absent from node_modules) and tsx is pruned.
 *        b. The `@vt/vt-daemon` package's `dist/vtd.mjs` build (workspace dev
 *           with a built dist).
 *        c. The TS source `bin/vtd.ts` under `--import tsx` (clean workspace
 *           checkout with no built dist). Source is preferred over a STALE
 *           dist so dev never silently runs an outdated bundle.
 *
 * The Node runtime is selected via graphd's `resolveDaemonRuntimeCommand`
 * helper — which explicitly REJECTS the Electron binary as a host (node:sqlite
 * ABI; Electron would also treat a .ts entry as a renderer entrypoint rather
 * than execute it). The VTD child therefore always runs under a plain Node
 * runtime.
 *
 * The argv shape (`--project <project>`) is BF-371's contract — never
 * `--project-root` (that's graphd). The two arguments are intentionally
 * distinct so a misconfigured launcher fails loudly at `parseArgs` rather than
 * silently routing to the wrong daemon.
 */

import { existsSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CommandSpec } from '@vt/graph-db-client/autoLaunch/runtime'

const VTD_BIN_ENV_VAR = 'VT_DAEMON_BIN'

const requireFromHere = createRequire(import.meta.url)

export type ResolveVtDaemonCommandDeps = {
  readonly env: NodeJS.ProcessEnv
  readonly runtimeCommand: () => string
}

/**
 * Injectable entrypoint-location seams. Production uses
 * {@link defaultEntrypointDeps}; tests pass synthetic deps to exercise the
 * bundle-vs-source preference without touching the real filesystem.
 */
export type DaemonEntrypointDeps = {
  readonly exists: (path: string) => boolean
  readonly resolveTsx: () => string
  readonly siblingDaemonPath: () => string | undefined
}

// Lazy: `vt --help` / `vt manual` never spawn the daemon, and the workspace
// package may be unresolvable in a published-bundle layout — don't fail
// module-init for callers that never reach the daemon.
let cachedVtDaemonRoot: string | undefined
function resolveVtDaemonRoot(): string | undefined {
  if (cachedVtDaemonRoot !== undefined) return cachedVtDaemonRoot
  try {
    cachedVtDaemonRoot = dirname(requireFromHere.resolve('@vt/vt-daemon/package.json'))
    return cachedVtDaemonRoot
  } catch {
    return undefined
  }
}

function distBinPath(): string | undefined {
  const root = resolveVtDaemonRoot()
  return root === undefined ? undefined : resolve(root, 'dist', 'vtd.mjs')
}

function sourceBinPath(): string | undefined {
  const root = resolveVtDaemonRoot()
  return root === undefined ? undefined : resolve(root, 'bin', 'vtd.ts')
}

function defaultSiblingDaemonPath(): string | undefined {
  try {
    return toNodeReadableAsarPath(resolve(dirname(fileURLToPath(import.meta.url)), 'vtd.mjs'))
  } catch {
    return undefined
  }
}

function toNodeReadableAsarPath(path: string): string {
  return path.replace('/app.asar/', '/app.asar.unpacked/')
}

const defaultEntrypointDeps: DaemonEntrypointDeps = {
  exists: existsSync,
  resolveTsx: () => requireFromHere.resolve('tsx'),
  siblingDaemonPath: defaultSiblingDaemonPath,
}

function sourceIsNewerThan(sourcePath: string, distPath: string): boolean {
  try {
    return statSync(sourcePath).mtimeMs > statSync(distPath).mtimeMs
  } catch {
    return false
  }
}

export function resolveDefaultDaemonArgs(
  project: string,
  deps: DaemonEntrypointDeps = defaultEntrypointDeps,
): string[] {
  // Sibling bundle: published-tarball / packaged-Electron layout, where
  // vtd.mjs ships next to the bundle this module is compiled into. Checked
  // first because `@vt/vt-daemon` isn't resolvable in that layout, so the
  // workspace-package paths below would all return undefined.
  const sibling = deps.siblingDaemonPath()
  if (sibling !== undefined && deps.exists(sibling)) {
    return [sibling, '--project', project]
  }

  const dist = distBinPath()
  const source = sourceBinPath()
  const distExists = dist !== undefined && deps.exists(dist)
  const sourceExists = source !== undefined && deps.exists(source)

  // Workspace dev: if dist is stale relative to source, prefer source so dev
  // never silently runs an outdated bundle. Mirrors graphd's resolver.
  if (distExists && sourceExists && sourceIsNewerThan(source!, dist!)) {
    return ['--import', deps.resolveTsx(), source!, '--project', project]
  }

  if (distExists) return [dist!, '--project', project]

  if (sourceExists) return ['--import', deps.resolveTsx(), source!, '--project', project]

  throw new Error(
    'Could not locate vtd entrypoint. Looked for a sibling bundle ' +
      `(${sibling ?? '<unavailable>'}), the @vt/vt-daemon dist build ` +
      `(${dist ?? '<package not resolvable>'}), and its TS source ` +
      `(${source ?? '<package not resolvable>'}).`,
  )
}

export function resolveCommand(
  project: string,
  override?: string,
  deps?: ResolveVtDaemonCommandDeps,
): CommandSpec {
  if (deps === undefined) {
    throw new Error('resolveCommand requires explicit deps')
  }
  const explicit = override?.trim()
  if (explicit) return parseOverride(explicit, project, deps.env)

  const fromEnv = deps.env[VTD_BIN_ENV_VAR]?.trim()
  if (fromEnv) return parseOverride(fromEnv, project, deps.env)

  return {
    cmd: deps.runtimeCommand(),
    args: resolveDefaultDaemonArgs(project),
    env: { ...deps.env },
  }
}

function parseOverride(override: string, project: string, env: NodeJS.ProcessEnv): CommandSpec {
  const parts = override.split(/\s+/).filter((p) => p.length > 0)
  const [cmd, ...rest] = parts
  return { cmd, args: [...rest, '--project', project], env: { ...env } }
}
