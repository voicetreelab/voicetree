/** BF-138 verification — contract is compile+runtime consumable. Throwaway. */
import type { State, Command, ElementSpec, GraphStateAPI } from '../src/contract'
const empty: State = {
    graph: { nodes: {}, incomingEdgesIndex: new Map(), nodeByBaseName: new Map(), unresolvedLinksIndex: new Map() },
    roots: { loaded: new Set(), folderTree: [] },
    collapseSet: new Set(), selection: new Set(), layout: { positions: new Map() },
    meta: { schemaVersion: 1, revision: 0 },
}
const api: Pick<GraphStateAPI, 'project' | 'applyCommandWithDelta'> = {
    project: (s): ElementSpec => ({ nodes: [], edges: [], revision: s.meta.revision }),
    applyCommandWithDelta: (s, cmd) => ({
        state: { ...s, meta: { ...s.meta, revision: s.meta.revision + 1 } },
        delta: { revision: s.meta.revision + 1, cause: cmd },
    }),
}
const cmd: Command = { type: 'Collapse', folder: '/tmp/vault/tasks/' }
const { state, delta } = api.applyCommandWithDelta(empty, cmd)
const spec = api.project(state)
console.log(`OK rev=${state.meta.revision} cause=${delta.cause.type} nodes=${spec.nodes.length} edges=${spec.edges.length}`)
