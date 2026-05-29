import type {Graph} from '@vt/graph-model/graph'
import type {VaultState} from '@vt/graph-db-client'
import {getNormalizedDaemonGraph} from '@/shell/edge/main/runtime/electron/daemon/queries/daemon-graph-normalization'

type GraphSnapshotClient = {
    readonly getGraph: () => Promise<unknown>
    readonly getVault: () => Promise<VaultState>
}

export type ElectronGraphSnapshot = {
    readonly graph: Graph
    readonly projectRoot: string | null
    readonly vaultPaths: readonly string[]
    readonly writeFolderPath: string | null
}

export function getVaultPathsFromState(vaultState: VaultState): readonly string[] {
    return [
        vaultState.writeFolderPath,
        ...vaultState.readPaths.filter((path: string) => path !== vaultState.writeFolderPath),
    ]
}

export async function buildElectronGraphSnapshot(
    client: GraphSnapshotClient,
): Promise<ElectronGraphSnapshot> {
    const [graph, vaultState]: [Graph, VaultState] = await Promise.all([
        getNormalizedDaemonGraph(client),
        client.getVault(),
    ])
    return {
        graph,
        projectRoot: vaultState.projectRoot,
        vaultPaths: getVaultPathsFromState(vaultState),
        writeFolderPath: vaultState.writeFolderPath,
    }
}
