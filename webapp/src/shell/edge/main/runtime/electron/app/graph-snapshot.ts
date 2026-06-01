import type {Graph} from '@vt/graph-model/graph'
import type {ProjectState} from '@vt/graph-db-client'
import {getNormalizedDaemonGraph} from '@/shell/edge/main/runtime/electron/daemon/queries/daemon-graph-normalization'

type GraphSnapshotClient = {
    readonly getGraph: () => Promise<unknown>
    readonly getProject: () => Promise<ProjectState>
}

export type ElectronGraphSnapshot = {
    readonly graph: Graph
    readonly projectRoot: string | null
    readonly projectPaths: readonly string[]
    readonly writeFolderPath: string | null
}

export function getProjectPathsFromState(projectState: ProjectState): readonly string[] {
    return [
        projectState.writeFolderPath,
        ...projectState.readPaths.filter((path: string) => path !== projectState.writeFolderPath),
    ]
}

export async function buildElectronGraphSnapshot(
    client: GraphSnapshotClient,
): Promise<ElectronGraphSnapshot> {
    const [graph, projectState]: [Graph, ProjectState] = await Promise.all([
        getNormalizedDaemonGraph(client),
        client.getProject(),
    ])
    return {
        graph,
        projectRoot: projectState.projectRoot,
        projectPaths: getProjectPathsFromState(projectState),
        writeFolderPath: projectState.writeFolderPath,
    }
}
