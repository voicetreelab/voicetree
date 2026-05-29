// Resolution chain (design doc §2.7) for the daemon URL + the vault path used
// to locate the auth-token file. First hit wins. Failure here is *fatal at
// the CLI* — caller maps to `daemon_unreachable` (-32000).
//
// Chain:
//   1. $VOICETREE_DAEMON_URL                        — full URL override.
//   2. <discovered-vault>/.voicetree/rpc.port       — vault discovered by up-walking
//                                                     from `cwd` looking for `.voicetree/`.
//   3. $VOICETREE_PROJECT_PATH/.voicetree/rpc.port    — fallback when invoked
//                                                     outside any vault tree.
//
// The vault root (for the auth token) is whichever step's vault resolved the
// port. Override sets the URL but not the vault — caller passes
// `$VOICETREE_PROJECT_PATH` explicitly in that case.

import {existsSync, statSync} from 'node:fs'
import {dirname, resolve} from 'node:path'

import {getProjectDotVoicetreePath} from '@vt/app-config/paths'
import {readRpcPortFile} from './portFile.ts'

export interface ResolvedDaemonEndpoint {
    readonly url: string
    readonly vaultPath: string | null
    readonly source: 'env_url' | 'cwd_up_walk' | 'env_vault_path'
}

// `cwd` and `env` are required inputs. The transitive-purity gate flags
// `process.*` access inside any function body — including parameter
// defaults — so callers thread the shell values in from the boundary.
export interface DiscoveryOptions {
    readonly cwd: string
    readonly env: Record<string, string | undefined>
}

const LOOPBACK_HOST: string = '127.0.0.1'

function envOr(env: Record<string, string | undefined>, key: string): string | undefined {
    const v: string | undefined = env[key]
    return v && v.length > 0 ? v : undefined
}

// Up-walk: starting at `from`, climb until we hit a directory containing a
// `.voicetree/` subdir. Returns the vault root (the directory containing
// `.voicetree/`), not `.voicetree/` itself.
export function detectVaultFromCwd(from: string): string | null {
    let dir: string = resolve(from)
    while (true) {
        const candidate: string = getProjectDotVoicetreePath(dir)
        try {
            if (existsSync(candidate) && statSync(candidate).isDirectory()) {
                return dir
            }
        } catch {
            // ignore permission errors and keep climbing
        }
        const parent: string = dirname(dir)
        if (parent === dir) return null
        dir = parent
    }
}

function urlForLocalhostPort(port: number): string {
    return `http://${LOOPBACK_HOST}:${port}`
}

export async function discoverDaemonEndpoint(
    options: DiscoveryOptions,
): Promise<ResolvedDaemonEndpoint | null> {
    const {env, cwd} = options

    const explicit: string | undefined = envOr(env, 'VOICETREE_DAEMON_URL')
    if (explicit) {
        return {
            url: explicit,
            vaultPath: envOr(env, 'VOICETREE_PROJECT_PATH') ?? null,
            source: 'env_url',
        }
    }

    const detectedVault: string | null = detectVaultFromCwd(cwd)
    if (detectedVault) {
        const port: number | null = await readRpcPortFile(detectedVault)
        if (port !== null) {
            return {url: urlForLocalhostPort(port), vaultPath: detectedVault, source: 'cwd_up_walk'}
        }
    }

    const fallbackVault: string | undefined = envOr(env, 'VOICETREE_PROJECT_PATH')
    if (fallbackVault) {
        const port: number | null = await readRpcPortFile(fallbackVault)
        if (port !== null) {
            return {url: urlForLocalhostPort(port), vaultPath: resolve(fallbackVault), source: 'env_vault_path'}
        }
    }

    return null
}

export interface VaultDiscoveryOptions {
    readonly env: Record<string, string | undefined>
}

// Explicit-vault resolution. Used when the caller already knows which vault
// to talk to (e.g. graph-tools' `createLiveTransport(vaultPath)`) and wants
// to bypass the cwd up-walk entirely. `$VOICETREE_DAEMON_URL` still wins —
// it's a per-process override — but the token always comes from the
// explicit vault, not from `$VOICETREE_PROJECT_PATH`. Replaces the
// `discoverDaemonEndpoint({cwd: '/'})` trick 9d used.
export async function discoverDaemonEndpointForVault(
    vaultPath: string,
    options: VaultDiscoveryOptions,
): Promise<ResolvedDaemonEndpoint | null> {
    if (vaultPath.length === 0) return null
    const {env} = options
    const resolvedVault: string = resolve(vaultPath)

    const explicit: string | undefined = envOr(env, 'VOICETREE_DAEMON_URL')
    if (explicit) {
        return {url: explicit, vaultPath: resolvedVault, source: 'env_url'}
    }

    const port: number | null = await readRpcPortFile(resolvedVault)
    if (port === null) return null
    return {url: urlForLocalhostPort(port), vaultPath: resolvedVault, source: 'env_vault_path'}
}
