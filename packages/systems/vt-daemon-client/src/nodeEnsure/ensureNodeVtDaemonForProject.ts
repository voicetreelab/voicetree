import {
    emitOwnerDiagnostic,
    readOwnerRecord,
    sleep,
    type CallerKind,
} from '@vt/daemon-lifecycle'
import {
    attemptSpawnAndWait,
    gatherEvidence,
    reclaimStaleOwner,
} from '@vt/graph-db-client/autoLaunch/spawnCoordinator'
import {resolveDaemonRuntimeCommand} from '@vt/graph-db-client/autoLaunch/runtime'
import {authTokenFilePath} from '@vt/vt-rpc'
import {VtDaemonClient} from '../VtDaemonClient.ts'
import {
    createEnsureVtDaemonState,
    ensureVtDaemonForProject,
} from '../autoLaunch/ensureVtDaemon.ts'
import type {
    EnsureVtDaemonDeps,
    EnsureVtDaemonOptions,
    EnsureVtDaemonResult,
} from '../autoLaunch/ensureVtDaemonTypes.ts'
import {
    resolveCommand,
    type ResolveVtDaemonCommandDeps,
} from '../autoLaunch/runtime.ts'

const state = createEnsureVtDaemonState<VtDaemonClient>()

export interface NodeEnsureVtDaemonRuntime {
    readonly env: NodeJS.ProcessEnv
    readonly mkdir: (path: string, opts: {readonly recursive: true}) => Promise<unknown>
    readonly newAttemptId: () => string
    readonly now: () => number
    readonly readTextFileSync: (path: string, encoding: BufferEncoding) => string
    readonly resolvePath: (path: string) => string
}

// The daemon entrypoint (sibling bundle / dist / tsx source) is located inside
// `resolveCommand` via `import.meta.url`-relative resolution, so the runtime no
// longer needs to inject a module resolver. It only supplies the spawn env and
// the Node runtime selector.
function buildResolveCommandDeps(runtime: NodeEnsureVtDaemonRuntime): ResolveVtDaemonCommandDeps {
    return {
        env: runtime.env,
        runtimeCommand: (): string => resolveDaemonRuntimeCommand({env: runtime.env}),
    }
}

function readVtdAuthTokenSync(runtime: NodeEnsureVtDaemonRuntime, project: string): string {
    const path = authTokenFilePath(project)
    const token = runtime.readTextFileSync(path, 'utf8').trim()
    if (token.length === 0) {
        throw new Error(`vt-daemon auth token at ${path} is empty`)
    }
    return token
}

function buildDeps(runtime: NodeEnsureVtDaemonRuntime): EnsureVtDaemonDeps<VtDaemonClient> {
    return {
        attemptSpawnAndWait,
        clientFor: (port: number, project: string): VtDaemonClient =>
            new VtDaemonClient({
                baseUrl: `http://127.0.0.1:${port}`,
                authToken: readVtdAuthTokenSync(runtime, project),
            }),
        emitOwnerDiagnostic,
        gatherEvidence,
        mkdir: runtime.mkdir,
        newAttemptId: runtime.newAttemptId,
        now: runtime.now,
        readOwnerRecord,
        reclaimStaleOwner,
        resolveCommand: (project: string, override?: string) =>
            resolveCommand(project, override, buildResolveCommandDeps(runtime)),
        resolvePath: runtime.resolvePath,
        sleep,
    }
}

export function ensureNodeVtDaemonForProject(
    runtime: NodeEnsureVtDaemonRuntime,
    project: string,
    caller: CallerKind,
    options: EnsureVtDaemonOptions = {},
): Promise<EnsureVtDaemonResult<VtDaemonClient>> {
    return ensureVtDaemonForProject(state, buildDeps(runtime), project, caller, options)
}
