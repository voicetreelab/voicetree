// Install a minimal `window.electronAPI` that bridges renderer code to the
// in-browser daemon. Two pipelines depend on this surface:
//
//   1. folderCollapse (chevron tap → setFolderStateThroughDaemon)
//   2. floating editor stack (createFloatingEditor → getGraph/getNode/
//      loadSettings; modifyNodeContentFromFloatingEditor → apply*Delta*)
//
// `setFolderStateThroughDaemon` runs real project() and emits a new
// ProjectedGraph. `getGraph`/`getNode` return the daemon's underlying Graph.
// `loadSettings` returns DEFAULT_SETTINGS (the editor stack only reads a
// handful of fields for layout/UI behaviour). The two `applyGraphDeltaToDB*`
// write paths are intentionally no-ops in this read-only playground —
// CodeMirror edits stay in the editor buffer and do NOT round-trip to the
// graph. The rest of electronAPI is a Proxy returning no-op async functions
// so defensive boot-time probes don't crash.

import type { ProjectedGraph } from '@vt/graph-state/contract'
import type { Graph, GraphNode } from '@vt/graph-model'
import { DEFAULT_SETTINGS } from '@vt/graph-model/settings'

import type { InBrowserDaemon, FolderState } from './inBrowserDaemon'

export function installElectronApiStub(daemon: InBrowserDaemon): void {
    const subscribers: Set<(graph: ProjectedGraph) => void> = new Set()

    daemon.onProjectionUpdate((graph: ProjectedGraph): void => {
        for (const cb of subscribers) cb(graph)
    })

    // Build a Proxy for `main.*` so any RPC method shipped renderer code may
    // call during boot (terminal restoration, project probe, etc.) returns
    // `undefined`/`null` rather than throwing on access. The handful of
    // methods the playground actually needs are explicitly handled.
    const mainTarget: Record<string, (...args: unknown[]) => Promise<unknown>> = {
        setFolderStateThroughDaemon: async (folderId: unknown, state: unknown): Promise<ProjectedGraph> => {
            return daemon.setFolderState(folderId as string, state as FolderState)
        },
        // Editor stack: createFloatingEditor + HoverEditor + AnchoredEditor
        // all read from getGraph()/getNode() to derive node content + title.
        getGraph: async (): Promise<Graph> => daemon.graph,
        getNode: async (nodeId: unknown): Promise<GraphNode | undefined> =>
            daemon.graph.nodes[nodeId as string],
        // FloatingEditorCRUD + AnchoredEditor read settings for layout sizing
        // and presentation-mode decisions. Defaults are sufficient — no user
        // overrides apply in the playground.
        loadSettings: async (): Promise<typeof DEFAULT_SETTINGS> => DEFAULT_SETTINGS,
        // Read-only mode: modifyNodeContentFromFloatingEditor calls these on
        // every CodeMirror edit. Returning null is the documented "no-op"
        // contract; renderer code ignores the result and the daemon Graph
        // stays unchanged. See playground README for round-trip-fidelity
        // implications.
        applyGraphDeltaToDBThroughMemUIAndEditorExposed: async (): Promise<null> => null,
        applyGraphDeltaToDBThroughMemAndUIExposed: async (): Promise<null> => null,
        // Image-viewer surface is aliased to a no-op stub; this entry is here
        // as a defensive belt because some code paths may probe it before the
        // alias takes effect.
        readImageAsDataUrl: async (): Promise<null> => null,
    }
    const mainProxy: typeof mainTarget = new Proxy(mainTarget, {
        get(target: typeof mainTarget, prop: string | symbol): unknown {
            if (prop in target) return target[prop as string]
            // Any other RPC: return a no-op async function
            return async (): Promise<null> => null
        },
    })

    const electronApi: Window['electronAPI'] = {
        main: mainProxy as unknown as NonNullable<Window['electronAPI']>['main'],
        graph: {
            getCurrentProjectedGraph: async (): Promise<ProjectedGraph> => daemon.getProjection(),
            onProjectedGraphUpdate: (callback: (graph: ProjectedGraph) => void): (() => void) => {
                subscribers.add(callback)
                // Hydrate immediately so the renderer sees the initial graph
                // on first subscribe — mirrors the daemon's catch-up emit.
                queueMicrotask((): void => { callback(daemon.getProjection()) })
                return (): void => { subscribers.delete(callback) }
            },
            onGraphClear: (_callback: () => void): (() => void) => (): void => {},
        },
        terminal: {
            spawn: async (): Promise<{ success: boolean; terminalId?: string; error?: string }> =>
                ({ success: false, error: 'playground: terminals disabled' }),
        },
        onBackendLog: (): void => {},
        onProjectSwitching: (): (() => void) => (): void => {},
        onProjectReady: (): (() => void) => (): void => {},
        onProjectLost: (): (() => void) => (): void => {},
        onViewSwitched: (): (() => void) => (): void => {},
        removeAllListeners: (): void => {},
        invoke: async (): Promise<unknown> => null,
        on: (): void => {},
        off: (): void => {},
    }

    window.electronAPI = electronApi
}
