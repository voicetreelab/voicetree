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
    ensureVtDaemonForVault,
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
    readonly resolveModule: (specifier: string) => string
    readonly resolvePath: (path: string) => string
}

function resolveVtdBinPath(runtime: NodeEnsureVtDaemonRuntime): string {
    return runtime.resolveModule('@vt/vt-daemon/bin/vtd.ts')
}

function resolveTsxLoader(runtime: NodeEnsureVtDaemonRuntime): string {
    return runtime.resolveModule('tsx')
}

function buildResolveCommandDeps(runtime: NodeEnsureVtDaemonRuntime): ResolveVtDaemonCommandDeps {
    return {
        env: runtime.env,
        runtimeCommand: (): string => resolveDaemonRuntimeCommand({env: runtime.env}),
        tsxLoaderPath: resolveTsxLoader(runtime),
        vtdBinPath: resolveVtdBinPath(runtime),
    }
}

function readVtdAuthTokenSync(runtime: NodeEnsureVtDaemonRuntime, vault: string): string {
    const path = authTokenFilePath(vault)
    const token = runtime.readTextFileSync(path, 'utf8').trim()
    if (token.length === 0) {
        throw new Error(`vt-daemon auth token at ${path} is empty`)
    }
    return token
}

function buildDeps(runtime: NodeEnsureVtDaemonRuntime): EnsureVtDaemonDeps<VtDaemonClient> {
    return {
        attemptSpawnAndWait,
        clientFor: (port: number, vault: string): VtDaemonClient =>
            new VtDaemonClient({
                baseUrl: `http://127.0.0.1:${port}`,
                authToken: readVtdAuthTokenSync(runtime, vault),
            }),
        emitOwnerDiagnostic,
        gatherEvidence,
        mkdir: runtime.mkdir,
        newAttemptId: runtime.newAttemptId,
        now: runtime.now,
        readOwnerRecord,
        reclaimStaleOwner,
        resolveCommand: (vault: string, override?: string) =>
            resolveCommand(vault, override, buildResolveCommandDeps(runtime)),
        resolvePath: runtime.resolvePath,
        sleep,
    }
}

export function ensureNodeVtDaemonForVault(
    runtime: NodeEnsureVtDaemonRuntime,
    vault: string,
    caller: CallerKind,
    options: EnsureVtDaemonOptions = {},
): Promise<EnsureVtDaemonResult<VtDaemonClient>> {
    return ensureVtDaemonForVault(state, buildDeps(runtime), vault, caller, options)
}
