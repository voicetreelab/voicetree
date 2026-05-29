/**
 * CLI-local doc-only ToolSpecs for the `vt graph live` family.
 *
 * The `graph live` family bridges the CLI to a running Electron app over
 * the live transport (JSON-RPC). This file owns the `view` verb directly
 * and re-exports the per-subfamily spec files (kept under the 500-line
 * limit):
 *   - graph-live-crud.ts → add-node / rm-node / add-edge / rm-edge / mv-node
 *   - graph-live-ego.ts  → focus / neighbors / path
 *
 * NOTE: `vt graph live state dump` (`vt_get_live_state`) and
 * `vt graph live apply` (`vt_dispatch_live_command`) are daemon-dispatched
 * tools and live in `TOOL_SPECS` (tool-specs.ts) — they are intentionally
 * EXCLUDED from this CLI-local family.
 *
 * NOTE: the historical `--port` flag was removed; it is not documented on
 * any verb here because the code does not honor it.
 *
 * Grounded in:
 *   - packages/libraries/graph-tools/bin/vt-graph/commands/live.ts
 *     (parseLiveViewArgs, runLiveCommand `view` branch + summary line)
 *   - packages/libraries/graph-tools/src/live/live.ts (liveView: collapse /
 *     select dispatch as best-effort, empty-roots message, endpoint
 *     resolution via createLiveTransport)
 */

import type {ToolSpec} from '../tool-spec-types.ts'
import {GRAPH_LIVE_CRUD_SPECS} from './graph-live-crud.ts'
import {GRAPH_LIVE_EGO_SPECS} from './graph-live-ego.ts'

const VT_GRAPH_LIVE_VIEW_SPEC: ToolSpec = {
    cliVerb: 'vt graph live view',
    tier: 'reference',
    summary: "Render the running app's live graph to the terminal as ASCII (default) or Mermaid.",
    description:
        "Render the running app's live graph to the terminal as ASCII "
        + '(default) or Mermaid. Reads the daemon-owned SerializedState over '
        + 'JSON-RPC (`vt_get_live_state`) and renders the projected view '
        + 'locally via `renderProjectedLiveView`.\n\n'
        + 'Before rendering, any `--collapse <folder>` flags are dispatched as '
        + '`SetFolderState` (state `collapsed`) commands and any `--select '
        + '<id>` flags as a single `Select` command — these mutate the live '
        + "session's view state and are best-effort (a failed collapse/select "
        + 'logs to stderr but does not block rendering). When no roots are '
        + 'loaded in the live state, prints `(no loaded roots in live '
        + 'state)`.\n\n'
        + 'In ASCII format only, a trailing summary line is appended: `<N> '
        + 'nodes — <F> folder nodes, <V> virtual folders, <C> files`. Mermaid '
        + 'format omits the summary.\n\n'
        + 'This verb is CLI-local and does not dispatch to a dedicated daemon '
        + 'RPC; it reads live state via `vt_get_live_state` (plus best-effort '
        + '`vt_dispatch_live_command` for `--collapse`/`--select`). Requires a '
        + 'running daemon. Endpoint resolution is via the live transport: '
        + '`$VOICETREE_DAEMON_URL` (per-process override) → cwd up-walk to the '
        + 'enclosing project → `$VOICETREE_PROJECT_PATH`; surfaces '
        + '`DaemonUnreachable` / `DaemonAuthRequired` when none is reachable.',
    inputs: [
        {
            cliBulletLabel: '--mermaid | --ascii',
            annotation: '',
            description:
                'Render format. `--ascii` (default) emits a tree plus a '
                + 'node-count summary line; `--mermaid` emits Mermaid source '
                + 'with no summary.',
        },
        {
            cliBulletLabel: '--collapse VALUE',
            annotation: '',
            description:
                'Collapse the named folder in the live view before rendering '
                + '(repeatable). Dispatched as a `SetFolderState` (collapsed) '
                + 'command on viewId `main`; best-effort — a failure logs to '
                + 'stderr and does not block rendering.',
        },
        {
            cliBulletLabel: '--select VALUE',
            annotation: '',
            description:
                'Select the named node id in the live view before rendering '
                + '(repeatable). All ids are dispatched together as a single '
                + '`Select` command; best-effort.',
        },
    ],
}

export const GRAPH_LIVE_SPECS: readonly ToolSpec[] = [
    VT_GRAPH_LIVE_VIEW_SPEC,
    ...GRAPH_LIVE_CRUD_SPECS,
    ...GRAPH_LIVE_EGO_SPECS,
]
