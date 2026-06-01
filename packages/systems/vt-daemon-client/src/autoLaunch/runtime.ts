/**
 * Spawn-command resolver for the standalone vt-daemon (VTD).
 *
 * Sibling of `@vt/graph-db-client/autoLaunch/spawn/runtime.ts` (which
 * resolves vt-graphd's spawn command). The two live in their own packages
 * because the daemons take different argv shapes (graphd: `--project-root`,
 * vtd: `--project`) and locate their entrypoints differently (graphd searches
 * for sibling bundles inside `@voicetree/cli`; vtd resolves the
 * `@vt/vt-daemon` package directly).
 *
 * Resolution order:
 *   1. If `override` (the BF-373 `EnsureVtDaemonOptions.bin`) is set, parse
 *      it as `<cmd> [args…]` and append `--project <project>`. Tests use this
 *      to point at `fake-vtd.mjs`.
 *   2. Else if `VT_DAEMON_BIN` env var is set, treat it the same way.
 *   3. Else resolve `@vt/vt-daemon`'s `bin/vtd.ts` via Node's package
 *      resolver and run it under `--import tsx` so a workspace dev (no
 *      built dist) can still spawn the daemon.
 *
 * The Node runtime is selected via graphd's `resolveDaemonRuntimeCommand`
 * helper — which explicitly REJECTS the Electron binary as a host. When
 * Electron Main spawns the VTD child, `process.execPath` is the Electron
 * binary; invoking it with `--import tsx vtd.ts --project X` silently fails
 * (Electron treats vtd.ts as a renderer entrypoint instead of executing it
 * as a Node script), the VTD never opens its HTTP port, and the renderer's
 * project-open chain hangs waiting for a daemon that will never appear.
 *
 * The argv shape (`--project <project>`) is BF-371's contract — never
 * `--project-root` (that's graphd). The two arguments are intentionally
 * distinct so a misconfigured launcher fails loudly at `parseArgs` rather
 * than silently routing to the wrong daemon.
 */

import type { CommandSpec } from '@vt/graph-db-client/autoLaunch/runtime'

const VTD_BIN_ENV_VAR = 'VT_DAEMON_BIN'

export type ResolveVtDaemonCommandDeps = {
  readonly env: NodeJS.ProcessEnv
  readonly runtimeCommand: () => string
  readonly tsxLoaderPath: string
  readonly vtdBinPath: string
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
    args: ['--import', deps.tsxLoaderPath, deps.vtdBinPath, '--project', project],
    env: { ...deps.env },
  }
}

function parseOverride(override: string, project: string, env: NodeJS.ProcessEnv): CommandSpec {
  const parts = override.split(/\s+/).filter((p) => p.length > 0)
  const [cmd, ...rest] = parts
  return { cmd, args: [...rest, '--project', project], env: { ...env } }
}
