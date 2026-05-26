/**
 * Spawn-command resolver for the standalone vt-daemon (VTD).
 *
 * Sibling of `@vt/graph-db-client/autoLaunch/spawn/runtime.ts` (which
 * resolves vt-graphd's spawn command). The two live in their own packages
 * because the daemons take different argv shapes (graphd: `--project-root`,
 * vtd: `--vault`) and locate their entrypoints differently (graphd searches
 * for sibling bundles inside `@voicetree/cli`; vtd resolves the
 * `@vt/vt-daemon` package directly).
 *
 * Resolution order:
 *   1. If `override` (the BF-373 `EnsureVtDaemonOptions.bin`) is set, parse
 *      it as `<cmd> [args…]` and append `--vault <vault>`. Tests use this
 *      to point at `fake-vtd.mjs`.
 *   2. Else if `VT_DAEMON_BIN` env var is set, treat it the same way.
 *   3. Else resolve `@vt/vt-daemon`'s `bin/vtd.ts` via Node's package
 *      resolver and run it under `--import tsx` so a workspace dev (no
 *      built dist) can still spawn the daemon.
 *
 * The argv shape (`--vault <vault>`) is BF-371's contract — never
 * `--project-root` (that's graphd). The two arguments are intentionally
 * distinct so a misconfigured launcher fails loudly at `parseArgs` rather
 * than silently routing to the wrong daemon.
 */

import { createRequire } from 'node:module'
import type { CommandSpec } from '@vt/graph-db-client/autoLaunch/spawn/runtime'

const requireFromHere = createRequire(import.meta.url)

const VTD_BIN_ENV_VAR = 'VT_DAEMON_BIN'

// Lazy: `vt --help` style commands never spawn VTD; we don't want
// module-init to fail when the workspace package isn't installed.
let cachedVtdBinPath: string | undefined
let cachedTsxPath: string | undefined

function resolveVtdBinPath(): string {
  if (cachedVtdBinPath !== undefined) return cachedVtdBinPath
  cachedVtdBinPath = requireFromHere.resolve('@vt/vt-daemon/bin/vtd.ts')
  return cachedVtdBinPath
}

function resolveTsxLoader(): string {
  if (cachedTsxPath !== undefined) return cachedTsxPath
  cachedTsxPath = requireFromHere.resolve('tsx')
  return cachedTsxPath
}

export function resolveCommand(
  vault: string,
  override?: string,
): CommandSpec {
  const explicit = override?.trim()
  if (explicit) return parseOverride(explicit, vault)

  const fromEnv = process.env[VTD_BIN_ENV_VAR]?.trim()
  if (fromEnv) return parseOverride(fromEnv, vault)

  return {
    cmd: process.execPath,
    args: ['--import', resolveTsxLoader(), resolveVtdBinPath(), '--vault', vault],
    env: { ...process.env },
  }
}

function parseOverride(override: string, vault: string): CommandSpec {
  const parts = override.split(/\s+/).filter((p) => p.length > 0)
  const [cmd, ...rest] = parts
  return { cmd, args: [...rest, '--vault', vault] }
}
