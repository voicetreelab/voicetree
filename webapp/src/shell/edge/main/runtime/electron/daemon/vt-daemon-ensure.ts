import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
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
import { resolveDaemonRuntimeCommand } from '@vt/graph-db-client/autoLaunch/runtime'
import { authTokenFilePath } from '@vt/vt-rpc'
import {
    VtDaemonClient,
    type EnsureVtDaemonResult,
} from '@vt/vt-daemon-client'
import {
    createEnsureVtDaemonState,
    ensureVtDaemonForVault as ensureVtDaemonForVaultWithDeps,
    resolveCommand,
    type EnsureVtDaemonDeps,
    type EnsureVtDaemonOptions,
    type ResolveVtDaemonCommandDeps,
} from '@vt/vt-daemon-client/autoLaunch'

const requireFromHere = createRequire(import.meta.url)
const state = createEnsureVtDaemonState<VtDaemonClient>()

function resolveVtdBinPath(): string {
    return requireFromHere.resolve('@vt/vt-daemon/bin/vtd.ts')
}

function resolveTsxLoader(): string {
    return requireFromHere.resolve('tsx')
}

function buildResolveCommandDeps(env: NodeJS.ProcessEnv): ResolveVtDaemonCommandDeps {
    return {
        env,
        runtimeCommand: (): string => resolveDaemonRuntimeCommand({env}),
        tsxLoaderPath: resolveTsxLoader(),
        vtdBinPath: resolveVtdBinPath(),
    }
}

function readVtdAuthTokenSync(vault: string): string {
    const path = authTokenFilePath(vault)
    const token = readFileSync(path, 'utf8').trim()
    if (token.length === 0) {
        throw new Error(`vt-daemon auth token at ${path} is empty`)
    }
    return token
}

function buildDeps(): EnsureVtDaemonDeps<VtDaemonClient> {
    const env: NodeJS.ProcessEnv = {...process.env}
    return {
        attemptSpawnAndWait,
        clientFor: (port: number, vault: string): VtDaemonClient =>
            new VtDaemonClient({
                baseUrl: `http://127.0.0.1:${port}`,
                authToken: readVtdAuthTokenSync(vault),
            }),
        emitOwnerDiagnostic,
        gatherEvidence,
        mkdir,
        newAttemptId: randomUUID,
        now: Date.now,
        readOwnerRecord,
        reclaimStaleOwner,
        resolveCommand: (vault: string, override?: string) =>
            resolveCommand(vault, override, buildResolveCommandDeps(env)),
        resolvePath: resolve,
        sleep,
    }
}

export function ensureVtDaemonForVault(
    vault: string,
    caller: CallerKind,
    options: EnsureVtDaemonOptions = {},
): Promise<EnsureVtDaemonResult<VtDaemonClient>> {
    return ensureVtDaemonForVaultWithDeps(state, buildDeps(), vault, caller, options)
}
