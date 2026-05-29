/**
 * CLI-local doc-only ToolSpecs for the typed `vt graph live` CRUD verbs:
 * `add-node`, `rm-node`, `add-edge`, `rm-edge`, and `mv-node`.
 *
 * These verbs are CLI-local (graph-tools-local). Each one builds a
 * SerializedCommand from file-path flags and dispatches it through the
 * `vt graph live apply` path (`vt_dispatch_live_command`), then persists
 * the change to disk so the on-disk graph and the live session stay in
 * sync. The CRUD verbs themselves do NOT dispatch to a dedicated daemon
 * RPC, so each spec omits the top-level `rpcName` and each input uses an
 * empty annotation with no `rpcName`.
 *
 * Grounded in:
 *   - packages/libraries/graph-tools/bin/vt-graph/commands/liveCrudParse.ts
 *     (LIVE_CRUD_FLAGS, per-verb command construction, defaults, paired
 *     --x/--y rule for add-node, required --x/--y for mv-node)
 *   - packages/libraries/graph-tools/bin/vt-graph/commands/live.ts
 *     (runLiveCommand CRUD branch: before/after node read + persist)
 *   - packages/systems/voicetree-cli/src/commands/graph/actions/live.ts
 *     (relative --file/--src-file/--tgt-file resolved against caller cwd)
 *
 * Note: the CRUD verbs do NOT accept `--port` (their flag set carries no
 * `--port`), so none is documented here.
 */

import type {ToolSpec} from '../tool-spec-types.ts'

const PROJECT_FLAG_DESCRIPTION =
    'Override the target project path. Defaults to the live-transport-resolved '
    + 'project (`$VOICETREE_DAEMON_URL` → cwd up-walk → '
    + '`$VOICETREE_PROJECT_PATH`).'

const VT_GRAPH_LIVE_ADD_NODE_SPEC: ToolSpec = {
    cliVerb: 'vt graph live add-node',
    tier: 'reference',
    summary: 'Add a node to the running app\'s live graph by file path. Returns the resulting Delta as JSON.',
    description:
        'Add a node to the live graph by file path. Returns the resulting '
        + 'Delta as JSON.\n\n'
        + 'Builds an `AddNode` SerializedCommand from `--file` (resolved to an '
        + 'absolute path and used as the node id) and dispatches it via the '
        + '`vt graph live apply` path (`vt_dispatch_live_command`). The node '
        + 'body defaults to a `# <basename>` heading (basename of `--file` with '
        + 'any `.md` extension stripped) unless `--label` is given. Position is '
        + 'optional via `--x`/`--y`, which must be supplied together — supplying '
        + 'only one fails; when both are omitted the node has no fixed '
        + 'position.\n\n'
        + 'After dispatch, the CLI persists the change to disk (reads the live '
        + 'graph node set before and after, then writes the corresponding '
        + 'markdown) so the on-disk graph and the live session stay in sync.\n\n'
        + 'This verb is CLI-local and does not dispatch to a dedicated daemon '
        + 'RPC of its own — it builds the SerializedCommand for you and routes '
        + 'it through `vt_dispatch_live_command`. A relative `--file` is '
        + 'resolved against the caller\'s working directory. Requires a running '
        + 'daemon.',
    inputs: [
        {
            cliBulletLabel: '--file VALUE',
            annotation: '',
            description:
                'Required. File path for the new node; resolved to an absolute '
                + 'path and used as the node id.',
        },
        {
            cliBulletLabel: '--label VALUE',
            annotation: '',
            description:
                'Optional node body text. Defaults to a `# <basename>` heading '
                + 'derived from `--file` (with any `.md` extension stripped).',
        },
        {
            cliBulletLabel: '--x VALUE',
            annotation: '',
            description:
                'Optional x coordinate (number). Must be supplied together '
                + 'with `--y`; supplying only one fails.',
        },
        {
            cliBulletLabel: '--y VALUE',
            annotation: '',
            description:
                'Optional y coordinate (number). Must be supplied together '
                + 'with `--x`.',
        },
        {
            cliBulletLabel: '--project VALUE',
            annotation: '',
            description: PROJECT_FLAG_DESCRIPTION,
        },
    ],
}

const VT_GRAPH_LIVE_RM_NODE_SPEC: ToolSpec = {
    cliVerb: 'vt graph live rm-node',
    tier: 'reference',
    summary: 'Remove a node from the live graph by file path. Returns the resulting Delta as JSON.',
    description:
        'Remove a node from the live graph by file path. Returns the resulting '
        + 'Delta as JSON.\n\n'
        + 'Builds a `RemoveNode` SerializedCommand whose `id` is the resolved '
        + 'absolute path of `--file`, dispatches it via the `vt graph live '
        + 'apply` path (`vt_dispatch_live_command`), then persists the change '
        + 'to disk so the on-disk graph matches the live session.\n\n'
        + 'This verb is CLI-local and does not dispatch to a dedicated daemon '
        + 'RPC of its own — it builds the SerializedCommand for you and routes '
        + 'it through `vt_dispatch_live_command`. A relative `--file` is '
        + 'resolved against the caller\'s working directory. Requires a running '
        + 'daemon.',
    inputs: [
        {
            cliBulletLabel: '--file VALUE',
            annotation: '',
            description:
                'Required. File path of the node to remove; resolved to an '
                + 'absolute path and used as the `RemoveNode` id.',
        },
        {
            cliBulletLabel: '--project VALUE',
            annotation: '',
            description: PROJECT_FLAG_DESCRIPTION,
        },
    ],
}

const VT_GRAPH_LIVE_ADD_EDGE_SPEC: ToolSpec = {
    cliVerb: 'vt graph live add-edge',
    tier: 'reference',
    summary: 'Add an edge to the live graph between two nodes. Returns the resulting Delta as JSON.',
    description:
        'Add an edge to the live graph between two nodes. Returns the resulting '
        + 'Delta as JSON.\n\n'
        + 'Builds an `AddEdge` SerializedCommand from `--src-file` (the edge '
        + '`source`, resolved to an absolute path) to `--tgt-file` (the edge '
        + '`targetId`, resolved to an absolute path), with an optional '
        + '`--label` (defaults to the empty string). Dispatches via the '
        + '`vt graph live apply` path (`vt_dispatch_live_command`), then '
        + 'persists the change to disk.\n\n'
        + 'This verb is CLI-local and does not dispatch to a dedicated daemon '
        + 'RPC of its own — it builds the SerializedCommand for you and routes '
        + 'it through `vt_dispatch_live_command`. Relative `--src-file` / '
        + '`--tgt-file` are resolved against the caller\'s working directory. '
        + 'Requires a running daemon.',
    inputs: [
        {
            cliBulletLabel: '--src-file VALUE',
            annotation: '',
            description:
                'Required. Source node file path; resolved to an absolute path '
                + '(the edge `source`).',
        },
        {
            cliBulletLabel: '--tgt-file VALUE',
            annotation: '',
            description:
                'Required. Target node file path; resolved to an absolute path '
                + '(the edge `targetId`).',
        },
        {
            cliBulletLabel: '--label VALUE',
            annotation: '',
            description: 'Optional edge label. Defaults to the empty string.',
        },
        {
            cliBulletLabel: '--project VALUE',
            annotation: '',
            description: PROJECT_FLAG_DESCRIPTION,
        },
    ],
}

const VT_GRAPH_LIVE_RM_EDGE_SPEC: ToolSpec = {
    cliVerb: 'vt graph live rm-edge',
    tier: 'reference',
    summary: 'Remove an edge from the live graph between two nodes. Returns the resulting Delta as JSON.',
    description:
        'Remove an edge from the live graph between two nodes. Returns the '
        + 'resulting Delta as JSON.\n\n'
        + 'Builds a `RemoveEdge` SerializedCommand from `--src-file` (the edge '
        + '`source`) to `--tgt-file` (the `targetId`), both resolved to '
        + 'absolute paths, dispatches via the `vt graph live apply` path '
        + '(`vt_dispatch_live_command`), then persists the change to disk.\n\n'
        + 'This verb is CLI-local and does not dispatch to a dedicated daemon '
        + 'RPC of its own — it builds the SerializedCommand for you and routes '
        + 'it through `vt_dispatch_live_command`. Relative `--src-file` / '
        + '`--tgt-file` are resolved against the caller\'s working directory. '
        + 'Requires a running daemon.',
    inputs: [
        {
            cliBulletLabel: '--src-file VALUE',
            annotation: '',
            description:
                'Required. Source node file path; resolved to an absolute path '
                + '(the edge `source`).',
        },
        {
            cliBulletLabel: '--tgt-file VALUE',
            annotation: '',
            description:
                'Required. Target node file path; resolved to an absolute path '
                + '(the edge `targetId`).',
        },
        {
            cliBulletLabel: '--project VALUE',
            annotation: '',
            description: PROJECT_FLAG_DESCRIPTION,
        },
    ],
}

const VT_GRAPH_LIVE_MV_NODE_SPEC: ToolSpec = {
    cliVerb: 'vt graph live mv-node',
    tier: 'reference',
    summary: 'Move a node to a new position in the live graph. Returns the resulting Delta as JSON.',
    description:
        'Move a node to a new position in the live graph. Returns the '
        + 'resulting Delta as JSON.\n\n'
        + 'Builds a `Move` SerializedCommand whose `id` is the resolved '
        + 'absolute path of `--file` and whose target is `{x, y}`. Both `--x` '
        + 'and `--y` are required and parsed as numbers. Dispatches via the '
        + '`vt graph live apply` path (`vt_dispatch_live_command`), then '
        + 'persists the new position to disk.\n\n'
        + 'This verb is CLI-local and does not dispatch to a dedicated daemon '
        + 'RPC of its own — it builds the SerializedCommand for you and routes '
        + 'it through `vt_dispatch_live_command`. A relative `--file` is '
        + 'resolved against the caller\'s working directory. Requires a running '
        + 'daemon.',
    inputs: [
        {
            cliBulletLabel: '--file VALUE',
            annotation: '',
            description:
                'Required. File path of the node to move; resolved to an '
                + 'absolute path and used as the `Move` id.',
        },
        {
            cliBulletLabel: '--x VALUE',
            annotation: '',
            description: 'Required. New x coordinate (parsed as a number).',
        },
        {
            cliBulletLabel: '--y VALUE',
            annotation: '',
            description: 'Required. New y coordinate (parsed as a number).',
        },
        {
            cliBulletLabel: '--project VALUE',
            annotation: '',
            description: PROJECT_FLAG_DESCRIPTION,
        },
    ],
}

export const GRAPH_LIVE_CRUD_SPECS: readonly ToolSpec[] = [
    VT_GRAPH_LIVE_ADD_NODE_SPEC,
    VT_GRAPH_LIVE_RM_NODE_SPEC,
    VT_GRAPH_LIVE_ADD_EDGE_SPEC,
    VT_GRAPH_LIVE_RM_EDGE_SPEC,
    VT_GRAPH_LIVE_MV_NODE_SPEC,
]
