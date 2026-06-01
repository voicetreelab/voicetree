// Resolution chain (design doc §2.7) for the daemon URL + the project path used
// to locate the auth-token file. First hit wins. Failure here is *fatal at
// the CLI* — caller maps to `daemon_unreachable` (-32000).
//
// Chain:
//   1. $VOICETREE_DAEMON_URL                        — full URL override.
//   2. <discovered-project>/.voicetree/rpc.port       — project discovered by up-walking
//                                                     from `cwd` looking for `.voicetree/`.
//   3. $VOICETREE_PROJECT_PATH/.voicetree/rpc.port    — fallback when invoked
//                                                     outside any project tree.
//
// The project root (for the auth token) is whichever step's project resolved the
// port. Override sets the URL but not the project — caller passes
// `$VOICETREE_PROJECT_PATH` explicitly in that case.

import {resolve} from 'node:path'

import {detectProjectFromCwd, hasVoicetreeMarker} from '@vt/paths'
import {readRpcPortFile} from './portFile.ts'

// The up-walk now lives in `@vt/paths` as the single shared implementation used
// by both the rpc resolver (here) and the graphd CLI resolver, so the two can
// never drift apart again. Re-exported to preserve this module's public symbol.
export {detectProjectFromCwd}

export interface ResolvedDaemonEndpoint {
    readonly url: string
    readonly projectPath: string | null
    readonly source: 'env_url' | 'cwd_up_walk' | 'env_project_path'
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
            projectPath: envOr(env, 'VOICETREE_PROJECT_PATH') ?? null,
            source: 'env_url',
        }
    }

    // `$VOICETREE_PROJECT_PATH` is authoritative over the CWD up-walk: the
    // spawner sets it to the canonical root the app talks to. An agent whose
    // CWD sits inside a nested project subfolder (carrying its own leftover
    // `.voicetree/`) would otherwise up-walk to the *inner* project and bind the
    // wrong per-project daemon. When the env var names a valid project root we
    // bind ITS daemon or return null — we never silently fall through to a
    // different project the CWD happens to resolve.
    const envProject: string | undefined = envOr(env, 'VOICETREE_PROJECT_PATH')
    if (envProject && hasVoicetreeMarker(envProject)) {
        const resolved: string = resolve(envProject)
        const port: number | null = await readRpcPortFile(resolved)
        return port !== null
            ? {url: urlForLocalhostPort(port), projectPath: resolved, source: 'env_project_path'}
            : null
    }

    const detectedProject: string | null = detectProjectFromCwd(cwd)
    if (detectedProject) {
        const port: number | null = await readRpcPortFile(detectedProject)
        if (port !== null) {
            return {url: urlForLocalhostPort(port), projectPath: detectedProject, source: 'cwd_up_walk'}
        }
    }

    return null
}

export interface ProjectDiscoveryOptions {
    readonly env: Record<string, string | undefined>
}

// Explicit-project resolution. Used when the caller already knows which project
// to talk to (e.g. graph-tools' `createLiveTransport(projectPath)`) and wants
// to bypass the cwd up-walk entirely. `$VOICETREE_DAEMON_URL` still wins —
// it's a per-process override — but the token always comes from the
// explicit project, not from `$VOICETREE_PROJECT_PATH`. Replaces the
// `discoverDaemonEndpoint({cwd: '/'})` trick 9d used.
export async function discoverDaemonEndpointForProject(
    projectPath: string,
    options: ProjectDiscoveryOptions,
): Promise<ResolvedDaemonEndpoint | null> {
    if (projectPath.length === 0) return null
    const {env} = options
    const resolvedProject: string = resolve(projectPath)

    const explicit: string | undefined = envOr(env, 'VOICETREE_DAEMON_URL')
    if (explicit) {
        return {url: explicit, projectPath: resolvedProject, source: 'env_url'}
    }

    const port: number | null = await readRpcPortFile(resolvedProject)
    if (port === null) return null
    return {url: urlForLocalhostPort(port), projectPath: resolvedProject, source: 'env_project_path'}
}
