/**
 * CLI-local doc-only specs for the top-level `vt view ...` family.
 *
 * Every verb here is implemented entirely inside the CLI
 * (`packages/systems/voicetree-cli/src/commands/node/view.ts`). None of
 * them dispatch to the vt-daemon JSON-RPC catalog: the runners call
 * `ensureDaemon(project)` and then talk to the per-project graph-db
 * daemon over REST (views are managed through `client.views.*`; folder
 * state, selection, and layout are mutated on `/sessions/:sessionId/...`).
 * Because there is no wire dispatch key, each spec omits the top-level
 * `rpcName` and every input uses an empty `annotation` with no `rpcName`.
 *
 * Authored against view.ts + viewFormatters.ts so the documented flags,
 * positionals, validation, and human/JSON output all match the source.
 */

import type {ToolSpec} from '../tool-spec-types.ts'

// ────────────────────────────────────────────────────────────────────────
// Shared input fragments. Project/json apply to every verb; session only
// to the verbs that resolve a session id (set-folder, selection, layout,
// show). list/switch/clone/delete never consume a session.
// ────────────────────────────────────────────────────────────────────────

const PROJECT_INPUT = {
    cliBulletLabel: '--project VALUE',
    annotation: '',
    description:
        'Override the resolved project path (also accepts `--project=VALUE`). '
        + 'Defaults to the active project for the current working directory; '
        + 'used to ensure and locate the graph-db daemon.',
} as const

const SESSION_INPUT = {
    cliBulletLabel: '--session VALUE',
    annotation: '',
    description:
        'Session id to operate on. Must be a non-empty value not starting '
        + 'with `-`. Falls back to `$VT_SESSION`, and if neither is set a new '
        + 'session is auto-created.',
} as const

const JSON_LAYOUT_INPUT = {
    cliBulletLabel: '--json',
    annotation: '',
    description:
        'Emit the LayoutResponse as JSON instead of the human-readable layout.',
} as const

const JSON_SELECTION_INPUT = {
    cliBulletLabel: '--json',
    annotation: '',
    description:
        'Emit the SelectionResponse as JSON instead of the human-readable '
        + '`Selection:` list.',
} as const

const SELECTION_NODE_IDS_INPUT = {
    cliBulletLabel: '<nodeIds...>',
    annotation: 'positional, variadic',
} as const

const VIEW_TARGET_INPUT = {
    cliBulletLabel: '<id-or-name>',
    annotation: 'positional',
} as const

// ────────────────────────────────────────────────────────────────────────
// View lifecycle verbs (list / show / switch / clone / delete).
// These manage named views via `client.views.*` and never use a session
// id; `--session` is therefore intentionally absent from their inputs.
// ────────────────────────────────────────────────────────────────────────

const VT_VIEW_LIST_SPEC: ToolSpec = {
    cliVerb: 'vt view list',
    tier: 'reference',
    summary: 'List all saved views for the project, marking the active one.',
    description:
        'List all saved views for the project, marking the active one. '
        + 'Implemented locally in the CLI: it ensures a graph-db daemon for '
        + 'the resolved project and calls `client.views.list()`. Human output '
        + 'prints a `Views:` block where each entry shows `name (viewId)` '
        + 'prefixed with `*` for the active view and `-` otherwise (or '
        + '`(none)` when there are no views); `--json` emits the full list of '
        + 'view records. Takes no positional arguments. This verb is '
        + 'CLI-local and does not dispatch to a vt-daemon JSON-RPC.',
    inputs: [PROJECT_INPUT, {
        cliBulletLabel: '--json',
        annotation: '',
        description:
            'Emit the list of view records as JSON instead of the '
            + 'human-readable `Views:` list.',
    }],
}

const VT_VIEW_SHOW_SPEC: ToolSpec = {
    cliVerb: 'vt view show',
    tier: 'reference',
    summary: "Show the active session's live view state and rendered graph.",
    description:
        "Show the active session's live view state and rendered graph. "
        + 'Implemented locally in the CLI: it ensures a graph-db daemon for '
        + 'the resolved project, resolves a session id (`--session`, then '
        + '`$VT_SESSION`, otherwise auto-creates a session), and fetches the '
        + 'session live-state snapshot with node content omitted. In '
        + 'human mode it then renders the active view by title and prints the '
        + 'rendered graph output; with `--json` (or when JSON mode is active) '
        + 'it instead emits the full LiveStateSnapshot — graph node count, '
        + 'folder roots, active view, folder state, selection, pan, zoom, '
        + 'positions, and revision. Takes no positional arguments. This verb '
        + 'is CLI-local and does not dispatch to a vt-daemon JSON-RPC.',
    inputs: [PROJECT_INPUT, SESSION_INPUT, {
        cliBulletLabel: '--json',
        annotation: '',
        description:
            'Emit the LiveStateSnapshot as JSON instead of the rendered '
            + 'graph output.',
    }],
}

const VT_VIEW_SWITCH_SPEC: ToolSpec = {
    cliVerb: 'vt view switch',
    tier: 'reference',
    summary: 'Activate a saved view by its id or name.',
    description:
        'Activate a saved view by its id or name. Takes a single '
        + '`<id-or-name>`; the CLI lists the views and resolves the target by '
        + 'matching `viewId` first, then `name`, erroring with `Unknown view: '
        + '<target>` if neither matches. Implemented locally: ensure a '
        + 'graph-db daemon for the resolved project, resolve the view, then '
        + 'call `client.views.activate(viewId)`. Human output prints '
        + '`Active View: <name> (<viewId>)`; `--json` emits the activated '
        + 'view record. This verb is CLI-local and does not dispatch to a '
        + 'vt-daemon JSON-RPC.',
    inputs: [
        {
            ...VIEW_TARGET_INPUT,
            description:
                'View to activate, matched against `viewId` first and then '
                + '`name`. Required; an unmatched value is a validation error.',
        },
        PROJECT_INPUT,
        {
            cliBulletLabel: '--json',
            annotation: '',
            description:
                'Emit the activated view record as JSON instead of the '
                + '`Active View:` line.',
        },
    ],
}

const VT_VIEW_CLONE_SPEC: ToolSpec = {
    cliVerb: 'vt view clone',
    tier: 'reference',
    summary: 'Clone an existing view under a new name.',
    description:
        'Clone an existing view under a new name. Takes exactly two '
        + 'positionals: `<src-id-or-name>` (resolved by matching `viewId` '
        + 'first, then `name`) and `<dst-name>` for the new view; fewer or '
        + 'more than two positionals is a validation error. Implemented '
        + 'locally: ensure a graph-db daemon for the resolved project, '
        + 'resolve the source view, then call '
        + '`client.views.clone(sourceViewId, dstName)`. Human output prints '
        + '`Cloned View: <name> (<viewId>)` for the new view; `--json` emits '
        + 'the cloned view record. This verb is CLI-local and does not '
        + 'dispatch to a vt-daemon JSON-RPC.',
    inputs: [
        {
            cliBulletLabel: '<src-id-or-name>',
            annotation: 'positional',
            description:
                'Source view to clone, matched against `viewId` first and '
                + 'then `name`. An unmatched value is a validation error.',
        },
        {
            cliBulletLabel: '<dst-name>',
            annotation: 'positional',
            description: 'Name for the newly cloned view.',
        },
        PROJECT_INPUT,
        {
            cliBulletLabel: '--json',
            annotation: '',
            description:
                'Emit the cloned view record as JSON instead of the '
                + '`Cloned View:` line.',
        },
    ],
}

const VT_VIEW_DELETE_SPEC: ToolSpec = {
    cliVerb: 'vt view delete',
    tier: 'reference',
    summary: 'Delete a saved view by its id or name.',
    description:
        'Delete a saved view by its id or name. Takes a single '
        + '`<id-or-name>`, resolved by matching `viewId` first and then '
        + '`name` (an unmatched value errors with `Unknown view: <target>`). '
        + 'Implemented locally: ensure a graph-db daemon for the resolved '
        + 'project, resolve the view, then call '
        + '`client.views.delete(viewId)`. Human output prints `Deleted View: '
        + '<name> (<viewId>)` for the removed view; `--json` emits the '
        + 'deleted view record. This verb is CLI-local and does not dispatch '
        + 'to a vt-daemon JSON-RPC.',
    inputs: [
        {
            ...VIEW_TARGET_INPUT,
            description:
                'View to delete, matched against `viewId` first and then '
                + '`name`. Required; an unmatched value is a validation error.',
        },
        PROJECT_INPUT,
        {
            cliBulletLabel: '--json',
            annotation: '',
            description:
                'Emit the deleted view record as JSON instead of the '
                + '`Deleted View:` line.',
        },
    ],
}

// ────────────────────────────────────────────────────────────────────────
// Folder-state verb (set-folder).
// ────────────────────────────────────────────────────────────────────────

const VT_VIEW_SET_FOLDER_SPEC: ToolSpec = {
    cliVerb: 'vt view set-folder',
    tier: 'reference',
    summary: "Set the expand/collapse/hide state of a folder in the active session's live view.",
    description:
        "Set the expand/collapse/hide state of a folder in the active "
        + "session's live view. Takes a folder `<path>` (resolved to an "
        + 'absolute path before sending) and one of `expanded`, `collapsed`, '
        + 'or `hidden`. Implemented locally in the CLI: it ensures a graph-db '
        + 'daemon for the resolved project, resolves a session id '
        + '(`--session`, then `$VT_SESSION`, otherwise auto-creates a '
        + 'session), then PATCHes `/sessions/:sessionId/folder-state/:path`. '
        + 'Human output prints `Folder State: <path> -> <state>`; `--json` '
        + 'echoes the request row. This verb is CLI-local and does not '
        + 'dispatch to a vt-daemon JSON-RPC.',
    inputs: [
        {
            cliBulletLabel: '<path>',
            annotation: 'positional',
            description:
                'Folder path whose view state to set. Resolved to an '
                + 'absolute path before sending.',
        },
        {
            cliBulletLabel: '<expanded|collapsed|hidden>',
            annotation: 'positional',
            description:
                'The folder view state to apply. Any other value is a '
                + 'validation error.',
        },
        PROJECT_INPUT,
        SESSION_INPUT,
        {
            cliBulletLabel: '--json',
            annotation: '',
            description:
                'Emit the result row as JSON instead of the human-readable '
                + '`Folder State:` line.',
        },
    ],
}

// ────────────────────────────────────────────────────────────────────────
// Selection verbs (set / add / remove). `set` maps to wire mode
// `replace`; `add` and `remove` map to themselves.
// ────────────────────────────────────────────────────────────────────────

const VT_VIEW_SELECTION_SET_SPEC: ToolSpec = {
    cliVerb: 'vt view selection set',
    tier: 'reference',
    summary: "Replace the active session's node selection with the given node ids.",
    description:
        "Replace the active session's node selection with the given node "
        + 'ids. Takes one or more `<nodeIds...>` (at least one is required). '
        + 'On the wire `set` maps to selection mode `replace`. Implemented '
        + 'locally: ensure a graph-db daemon for the resolved project, '
        + 'resolve the session id (`--session`, then `$VT_SESSION`, otherwise '
        + 'auto-created), then POST `{mode: "replace", nodeIds}` to '
        + '`/sessions/:sessionId/selection`. Human output prints the '
        + 'resulting `Selection:` list (or `(none)`); `--json` emits the full '
        + 'SelectionResponse. This verb is CLI-local and does not dispatch to '
        + 'a vt-daemon JSON-RPC.',
    inputs: [
        {
            ...SELECTION_NODE_IDS_INPUT,
            description:
                'One or more node ids that become the new selection (mode '
                + '`replace`). At least one is required.',
        },
        PROJECT_INPUT,
        SESSION_INPUT,
        JSON_SELECTION_INPUT,
    ],
}

const VT_VIEW_SELECTION_ADD_SPEC: ToolSpec = {
    cliVerb: 'vt view selection add',
    tier: 'reference',
    summary: "Add the given node ids to the active session's current selection.",
    description:
        "Add the given node ids to the active session's current selection. "
        + 'Takes one or more `<nodeIds...>` (at least one required) and sends '
        + 'selection mode `add`. Same local dispatch as `selection set`: '
        + 'ensure a graph-db daemon, resolve the session id, then POST '
        + '`{mode: "add", nodeIds}` to `/sessions/:sessionId/selection`. '
        + 'Human output prints the updated `Selection:` list; `--json` emits '
        + 'the SelectionResponse. This verb is CLI-local and does not '
        + 'dispatch to a vt-daemon JSON-RPC.',
    inputs: [
        {
            ...SELECTION_NODE_IDS_INPUT,
            description:
                'One or more node ids to add to the current selection (mode '
                + '`add`). At least one is required.',
        },
        PROJECT_INPUT,
        SESSION_INPUT,
        JSON_SELECTION_INPUT,
    ],
}

const VT_VIEW_SELECTION_REMOVE_SPEC: ToolSpec = {
    cliVerb: 'vt view selection remove',
    tier: 'reference',
    summary: "Remove the given node ids from the active session's current selection.",
    description:
        "Remove the given node ids from the active session's current "
        + 'selection. Takes one or more `<nodeIds...>` (at least one '
        + 'required) and sends selection mode `remove`. Same local dispatch '
        + 'as the other selection verbs: ensure a graph-db daemon, resolve '
        + 'the session id, then POST `{mode: "remove", nodeIds}` to '
        + '`/sessions/:sessionId/selection`. Human output prints the updated '
        + '`Selection:` list; `--json` emits the SelectionResponse. This verb '
        + 'is CLI-local and does not dispatch to a vt-daemon JSON-RPC.',
    inputs: [
        {
            ...SELECTION_NODE_IDS_INPUT,
            description:
                'One or more node ids to remove from the current selection '
                + '(mode `remove`). At least one is required.',
        },
        PROJECT_INPUT,
        SESSION_INPUT,
        JSON_SELECTION_INPUT,
    ],
}

// ────────────────────────────────────────────────────────────────────────
// Layout verbs (set-pan / set-zoom / set-positions). All PUT a partial
// layout mutation to `/sessions/:sessionId/layout`.
// ────────────────────────────────────────────────────────────────────────

const VT_VIEW_LAYOUT_SET_PAN_SPEC: ToolSpec = {
    cliVerb: 'vt view layout set-pan',
    tier: 'reference',
    summary: "Set the camera pan offset of the active session's live view.",
    description:
        "Set the camera pan offset of the active session's live view. Takes "
        + '`<x>` and `<y>`, each of which must parse to a finite number '
        + '(rejected otherwise). Implemented locally: ensure a graph-db '
        + 'daemon for the resolved project, resolve the session id, then PUT '
        + '`{pan: {x, y}}` to `/sessions/:sessionId/layout`. Human output '
        + 'prints the full layout (`Pan`, `Zoom`, and any saved '
        + '`Positions`); `--json` emits the LayoutResponse. This verb is '
        + 'CLI-local and does not dispatch to a vt-daemon JSON-RPC.',
    inputs: [
        {
            cliBulletLabel: '<x>',
            annotation: 'positional',
            description: 'Pan x offset. Must parse to a finite number.',
        },
        {
            cliBulletLabel: '<y>',
            annotation: 'positional',
            description: 'Pan y offset. Must parse to a finite number.',
        },
        PROJECT_INPUT,
        SESSION_INPUT,
        JSON_LAYOUT_INPUT,
    ],
}

const VT_VIEW_LAYOUT_SET_ZOOM_SPEC: ToolSpec = {
    cliVerb: 'vt view layout set-zoom',
    tier: 'reference',
    summary: "Set the camera zoom level of the active session's live view.",
    description:
        "Set the camera zoom level of the active session's live view. Takes "
        + 'a single `<zoom>` value that must parse to a finite number. '
        + 'Implemented locally: ensure a graph-db daemon, resolve the session '
        + 'id, then PUT `{zoom}` to `/sessions/:sessionId/layout`. Human '
        + 'output prints the full layout (`Pan`, `Zoom`, `Positions`); '
        + '`--json` emits the LayoutResponse. This verb is CLI-local and does '
        + 'not dispatch to a vt-daemon JSON-RPC.',
    inputs: [
        {
            cliBulletLabel: '<zoom>',
            annotation: 'positional',
            description: 'Zoom level. Must parse to a finite number.',
        },
        PROJECT_INPUT,
        SESSION_INPUT,
        JSON_LAYOUT_INPUT,
    ],
}

const VT_VIEW_LAYOUT_SET_POSITIONS_SPEC: ToolSpec = {
    cliVerb: 'vt view layout set-positions',
    tier: 'reference',
    summary: "Set explicit node positions in the active session's live view from a JSON file.",
    description:
        "Set explicit node positions in the active session's live view from "
        + 'a JSON file. Takes a single `<positions-json-file>` path (resolved '
        + 'to absolute) whose contents must be a JSON object mapping each '
        + 'node id to `{x, y}`, where both coordinates are finite numbers; '
        + 'malformed JSON, a non-object payload, or an invalid coordinate '
        + 'fails with a validation error naming the offending node. '
        + 'Implemented locally: read and validate the file, ensure the '
        + 'graph-db daemon, resolve the session id, then PUT `{positions}` to '
        + '`/sessions/:sessionId/layout`. Human output prints the full layout '
        + 'including the applied `Positions`; `--json` emits the '
        + 'LayoutResponse. This verb is CLI-local and does not dispatch to a '
        + 'vt-daemon JSON-RPC.',
    inputs: [
        {
            cliBulletLabel: '<positions-json-file>',
            annotation: 'positional',
            description:
                'Path (resolved to absolute) to a JSON file mapping each '
                + 'node id to `{x, y}` with finite coordinates. Invalid JSON, '
                + 'a non-object payload, or a bad coordinate is rejected with '
                + 'a validation error naming the node.',
        },
        PROJECT_INPUT,
        SESSION_INPUT,
        JSON_LAYOUT_INPUT,
    ],
}

// ────────────────────────────────────────────────────────────────────────
// Family aggregate, in VIEW_USAGE order.
// ────────────────────────────────────────────────────────────────────────

export const VIEW_SPECS: readonly ToolSpec[] = [
    VT_VIEW_LIST_SPEC,
    VT_VIEW_SHOW_SPEC,
    VT_VIEW_SWITCH_SPEC,
    VT_VIEW_CLONE_SPEC,
    VT_VIEW_DELETE_SPEC,
    VT_VIEW_SET_FOLDER_SPEC,
    VT_VIEW_SELECTION_SET_SPEC,
    VT_VIEW_SELECTION_ADD_SPEC,
    VT_VIEW_SELECTION_REMOVE_SPEC,
    VT_VIEW_LAYOUT_SET_PAN_SPEC,
    VT_VIEW_LAYOUT_SET_ZOOM_SPEC,
    VT_VIEW_LAYOUT_SET_POSITIONS_SPEC,
]
