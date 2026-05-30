/**
 * CLI-local doc-only ToolSpecs for the `vt graph live` ego-graph query
 * verbs: `focus`, `neighbors`, and `path`.
 *
 * These verbs are CLI-local (graph-tools-local): they fetch the live
 * SerializedState over JSON-RPC (`vt_get_live_state`) and then run pure
 * ego-graph algorithms locally to render the result. The verbs themselves
 * do NOT dispatch to a dedicated daemon RPC, so each spec omits the
 * top-level `rpcName` and each input uses an empty annotation with no
 * `rpcName`.
 *
 * Grounded in:
 *   - packages/libraries/graph-tools/bin/vt-graph/commands/live.ts
 *     (parseLiveNeighborhoodArgs, parseLivePathArgs, emitEgoRender,
 *     EGO_NOT_FOUND_EXIT_CODE = 3)
 *   - packages/libraries/graph-tools/src/view/egoGraph.ts
 *     (renderFocus / renderNeighbors / renderPath, undirected adjacency)
 *   - packages/libraries/graph-tools/src/live/live.ts
 *     (liveFocus / liveNeighbors / livePath endpoint resolution)
 */

import type {ToolSpec} from '../tool-spec-types.ts'

const PROJECT_FLAG_DESCRIPTION =
    'Override the target project path. Defaults to the live-transport-resolved '
    + 'project (`$VOICETREE_DAEMON_URL` → cwd up-walk → '
    + '`$VOICETREE_PROJECT_PATH`). Accepts either `--project <path>` or '
    + '`--project=<path>`.'

const VT_GRAPH_LIVE_FOCUS_SPEC: ToolSpec = {
    cliVerb: 'vt graph live focus',
    tier: 'reference',
    summary: "Render the N-hop ego graph centered on a node in the running app's live graph.",
    description:
        'Render the N-hop ego graph centered on a node in the live graph.\n\n'
        + 'Fetches the live SerializedState (`vt_get_live_state`), then renders '
        + 'the ego subgraph within `--hops` of the center node (default 1 hop) '
        + 'using undirected adjacency (a node\'s outgoing edges plus its '
        + 'incoming edges). Output leads with a `Focus: <node> (<hops>-hop ego '
        + 'graph, <N> nodes)` header, then groups the center\'s direct '
        + '`Incoming:` and `Outgoing:` edges, then lists any further '
        + '`Also reachable:` nodes within the hop budget. Node ids are shown as '
        + 'basenames.\n\n'
        + '**Exit-code semantics.** A valid query (center node exists) renders '
        + 'to stdout and exits 0. An unknown / typo\'d center node id writes '
        + '`node not found: <id>` to stderr and exits non-zero (code 3, '
        + '`EGO_NOT_FOUND_EXIT_CODE`), distinguishing a caller typo from a '
        + 'valid empty result.\n\n'
        + 'This verb is CLI-local and does not dispatch to a dedicated daemon '
        + 'RPC; it only reads live state via `vt_get_live_state`. Requires a '
        + 'running daemon. Endpoint resolution is via the live transport: '
        + '`$VOICETREE_DAEMON_URL` (per-process override) → cwd up-walk to the '
        + 'enclosing project → `$VOICETREE_PROJECT_PATH`.',
    inputs: [
        {
            cliBulletLabel: '<node>',
            annotation: 'positional',
            description:
                'Center node id of the ego graph. An unknown / typo\'d id '
                + 'writes `node not found: <id>` to stderr and exits non-zero '
                + '(code 3).',
        },
        {
            cliBulletLabel: '--hops VALUE',
            annotation: '',
            description:
                'Ego-graph radius in undirected hops (default 1). Accepts '
                + 'either `--hops N` or `--hops=N`.',
        },
        {
            cliBulletLabel: '--project VALUE',
            annotation: '',
            description: PROJECT_FLAG_DESCRIPTION,
        },
    ],
}

const VT_GRAPH_LIVE_NEIGHBORS_SPEC: ToolSpec = {
    cliVerb: 'vt graph live neighbors',
    tier: 'reference',
    summary: 'Render the N-hop neighborhood of a node in the live graph, excluding the center.',
    description:
        'Render the N-hop neighborhood of a node in the live graph, excluding '
        + 'the center.\n\n'
        + 'Fetches the live SerializedState (`vt_get_live_state`), then lists '
        + 'every node within `--hops` of the target (default 1 hop) over '
        + 'undirected adjacency, omitting the target itself. Output is a header '
        + '(`Neighbors of <node> (<hops>-hop): <count> found`) followed by the '
        + 'neighbor basenames.\n\n'
        + '**Exit-code semantics.** A valid query (target node exists) renders '
        + 'to stdout and exits 0. An unknown / typo\'d node id writes '
        + '`node not found: <id>` to stderr and exits non-zero (code 3, '
        + '`EGO_NOT_FOUND_EXIT_CODE`).\n\n'
        + 'This verb is CLI-local and does not dispatch to a dedicated daemon '
        + 'RPC; it only reads live state via `vt_get_live_state`. Requires a '
        + 'running daemon. Endpoint resolution is via the live transport '
        + '(`$VOICETREE_DAEMON_URL` → cwd up-walk → `$VOICETREE_PROJECT_PATH`).',
    inputs: [
        {
            cliBulletLabel: '<node>',
            annotation: 'positional',
            description:
                'Target node id whose neighborhood is rendered. An unknown / '
                + 'typo\'d id writes `node not found: <id>` to stderr and exits '
                + 'non-zero (code 3).',
        },
        {
            cliBulletLabel: '--hops VALUE',
            annotation: '',
            description:
                'Neighborhood radius in undirected hops (default 1). Accepts '
                + 'either `--hops N` or `--hops=N`.',
        },
        {
            cliBulletLabel: '--project VALUE',
            annotation: '',
            description: PROJECT_FLAG_DESCRIPTION,
        },
    ],
}

const VT_GRAPH_LIVE_PATH_SPEC: ToolSpec = {
    cliVerb: 'vt graph live path',
    tier: 'reference',
    summary: 'Render the shortest undirected path between two nodes in the live graph.',
    description:
        'Render the shortest undirected path between two nodes in the live '
        + 'graph.\n\n'
        + 'Fetches the live SerializedState (`vt_get_live_state`), then runs BFS '
        + 'for the shortest undirected path from `<a>` to `<b>`. On success '
        + 'prints the path as `a → … → b` (basenames) and exits 0. When both '
        + 'endpoints exist but are not connected, prints `no path from <a> to '
        + '<b>` to stdout and exits 0 — a genuine no-path is a valid result, '
        + 'not an error.\n\n'
        + '**Exit-code semantics.** If either endpoint is an unknown / typo\'d '
        + 'node id, writes `node not found: <ids>` to stderr and exits non-zero '
        + '(code 3, `EGO_NOT_FOUND_EXIT_CODE`). This deliberately distinguishes '
        + 'a typo (caller error) from a real disconnected pair (valid no-path); '
        + 'the underlying BFS returns null for both cases, so `renderPath` '
        + 'checks endpoint membership before running BFS.\n\n'
        + 'This verb is CLI-local and does not dispatch to a dedicated daemon '
        + 'RPC; it only reads live state via `vt_get_live_state`. It takes no '
        + '`--hops` flag (BFS always finds the shortest path). Requires a '
        + 'running daemon. Endpoint resolution is via the live transport '
        + '(`$VOICETREE_DAEMON_URL` → cwd up-walk → `$VOICETREE_PROJECT_PATH`).',
    inputs: [
        {
            cliBulletLabel: '<a>',
            annotation: 'positional',
            description: 'Start node id of the path query.',
        },
        {
            cliBulletLabel: '<b>',
            annotation: 'positional',
            description:
                'End node id of the path query. If either `<a>` or `<b>` is an '
                + 'unknown / typo\'d id, writes `node not found: <ids>` to '
                + 'stderr and exits non-zero (code 3); a real disconnected pair '
                + 'prints `no path` and exits 0.',
        },
        {
            cliBulletLabel: '--project VALUE',
            annotation: '',
            description: PROJECT_FLAG_DESCRIPTION,
        },
    ],
}

export const GRAPH_LIVE_EGO_SPECS: readonly ToolSpec[] = [
    VT_GRAPH_LIVE_FOCUS_SPEC,
    VT_GRAPH_LIVE_NEIGHBORS_SPEC,
    VT_GRAPH_LIVE_PATH_SPEC,
]
