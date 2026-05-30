/**
 * Spawn-time injection of the daemon's vt-bin directory onto each agent
 * terminal's PATH.
 *
 * The backend daemon owns the agent-spawn pipeline and knows where its
 * own `vt` CLI lives on disk. Spawned agent terminals need to call `vt`
 * as a bare command (`vt agent spawn`, `vt graph create`, etc.) — but
 * they inherit whatever PATH the daemon launched with, and the `vt`
 * binary is not on a standard PATH location. We fix this in the spawn
 * pipeline by prepending the daemon's known vt-bin directory to each
 * child's PATH env var.
 *
 * Putting the fix here — in the backend spawn pipeline — keeps the
 * Electron UI decoupled from the daemon's filesystem layout. PATH
 * manipulation works the same way on every OS (the only difference is
 * the path separator, which `node:path.delimiter` handles), so a
 * single mechanism covers Mac, Linux, WSL, and Windows shells alike.
 *
 * Design points:
 * - The vt-bin directory is supplied by the runtime env
 *   (`getVtBinDir`). Each shell (Electron main, vtd, test rig)
 *   wires its own location.
 * - When the env returns null (unconfigured), the function is a no-op
 *   and the child inherits PATH unchanged.
 * - Idempotent: re-running on an env that already starts with the
 *   vt-bin entry does not double-prepend.
 *
 * TODO(milestone-e-followup): add a daemon-boot smoke test that runs
 * `vt --version` from the configured vt-bin directory and surfaces a
 * loud failure if the binary is missing or non-executable. That check
 * belongs in whichever shell wires `getVtBinDir`, not in this pure
 * module.
 */

import {delimiter, isAbsolute, join} from 'node:path'
import {getRuntimeEnv} from '../runtime/runtime-config'

/**
 * Pure: returns a new env-var map with `vtBinDir` prepended to `PATH`.
 * - If `vtBinDir` is null or empty, returns `envVars` unchanged.
 * - If `PATH` is absent, sets it to `vtBinDir`.
 * - If `PATH` already begins with `vtBinDir` (followed by either the
 *   path delimiter or end-of-string), returns `envVars` unchanged so
 *   repeated calls do not stack entries.
 */
export function prependVtBinToPath(
    envVars: Record<string, string>,
    vtBinDir: string | null,
): Record<string, string> {
    if (vtBinDir === null || vtBinDir.length === 0) return envVars
    const existing: string | undefined = envVars.PATH
    if (existing === undefined || existing.length === 0) {
        return {...envVars, PATH: vtBinDir}
    }
    if (existing === vtBinDir || existing.startsWith(vtBinDir + delimiter)) {
        return envVars
    }
    return {...envVars, PATH: vtBinDir + delimiter + existing}
}

/**
 * Read the configured vt-bin directory from the runtime env. Returns
 * null if the current shell did not register `getVtBinDir`, making
 * `prependVtBinToPath` a no-op.
 */
export async function readVtBinDirOrNull(): Promise<string | null> {
    return getRuntimeEnv().getVtBinDir?.() ?? null
}

/**
 * Predicate dependency: returns true if the given absolute path exists
 * as a file. Shells inject `fs.existsSync` (or an in-memory equivalent
 * in tests).
 */
export type FileExistsCheck = (absolutePath: string) => boolean

/**
 * Resolve the vt-bin directory for a shell.
 *
 * Each shell knows where the `voicetree-cli` package lives on disk —
 * either by walking up from `import.meta.url` (vtd, vt serve) or by
 * reading a build-config-derived path (Electron, which already encodes
 * the dev vs. packaged split). The shell passes that candidate package
 * directory in; this function verifies the package actually ships a
 * `bin/vt` script and returns the absolute path to the `bin/` directory.
 *
 * Returns null when:
 * - `voicetreeCliPackageDir` is null (caller couldn't locate the package).
 * - The candidate is not absolute (defensive: prevents accidentally
 *   prepending a relative path onto PATH).
 * - `<dir>/bin/vt` does not exist (e.g. an Electron packaged build that
 *   doesn't bundle the CLI — the no-op path then takes over and the
 *   spawned terminal proceeds without `vt` on PATH).
 *
 * Pure with respect to its dependencies: takes `fileExists` so callers
 * can unit-test without touching the filesystem.
 */
export function resolveVtBinDir(
    voicetreeCliPackageDir: string | null,
    fileExists: FileExistsCheck,
): string | null {
    if (voicetreeCliPackageDir === null || voicetreeCliPackageDir.length === 0) return null
    if (!isAbsolute(voicetreeCliPackageDir)) return null
    const binDir: string = join(voicetreeCliPackageDir, 'bin')
    const vtScript: string = join(binDir, 'vt')
    if (!fileExists(vtScript)) return null
    return binDir
}
