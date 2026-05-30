/**
 * CLI-local doc-only specs for the `vt session` family.
 *
 * These verbs (`create`, `delete`, `show`) are implemented entirely on the
 * CLI side in `voicetree-cli/src/commands/runtime/session.ts` over the
 * `@vt/graph-db-client` HTTP REST surface of the graph-db-server
 * (`POST/GET/DELETE /sessions`). They do NOT dispatch through the vt-daemon
 * JSON-RPC tool catalog, so every spec omits the top-level `rpcName` and
 * each input omits `rpcName` with an empty `annotation`.
 */

import type {ToolSpec} from '../tool-spec-types.ts'

const PROJECT_FLAG_DESCRIPTION: string =
    'Override the resolved project root. Accepts `--project <path>` or '
    + '`--project=<path>`; the path is resolved relative to the current '
    + 'directory and must contain a `.voicetree/` directory. When omitted, the '
    + 'CLI searches upward from the current directory for a `.voicetree/` '
    + 'marker.'

const VT_SESSION_CREATE_SPEC: ToolSpec = {
    cliVerb: 'vt session create',
    tier: 'reference',
    summary: 'Create a new graph session and print its id.',
    description:
        'Create a new graph session and print its id. Resolves the active '
        + 'project (from `--project` or by searching upward from the current '
        + 'directory for a `.voicetree/` marker), auto-ensures a graph-db daemon '
        + 'for that project, and issues `POST /sessions` to the daemon\'s REST '
        + 'surface. The daemon\'s session registry mints a fresh UUID and '
        + 'returns `{ sessionId }` with HTTP 201. By default prints '
        + '`Session ID: <uuid>`; with `--json` (or when stdout is not a TTY) '
        + 'prints the raw `{ "sessionId": "<uuid>" }` JSON.\n\n'
        + 'This verb is implemented entirely CLI-side over the graph-db-server '
        + 'HTTP REST API (`createSession` in graph-db-client). It is NOT a '
        + 'vt-daemon JSON-RPC tool and has no entry in the daemon tool catalog, '
        + 'so there are no `(RPC: …)` parameter mappings.',
    inputs: [
        {
            cliBulletLabel: '--project VALUE',
            annotation: '',
            description: PROJECT_FLAG_DESCRIPTION,
        },
        {
            cliBulletLabel: '--json',
            annotation: '',
            description:
                'Emit the raw `{ sessionId }` JSON instead of the '
                + '`Session ID: <uuid>` human line. JSON output is also '
                + 'triggered automatically when stdout is not a TTY.',
        },
    ],
}

const VT_SESSION_DELETE_SPEC: ToolSpec = {
    cliVerb: 'vt session delete',
    tier: 'reference',
    summary: 'Delete a graph session by id.',
    description:
        'Delete a graph session by id. Resolves the active project (from '
        + '`--project` or upward `.voicetree/` discovery), auto-ensures the '
        + 'graph-db daemon, and issues `DELETE /sessions/<id>` to the daemon. '
        + 'The session registry removes the session and the daemon returns '
        + 'HTTP 204; a missing session returns 404 (surfaced as a CLI error). '
        + 'The `<id>` positional is required and exactly one id is accepted. '
        + 'On success prints `Deleted Session: <id>`; with `--json` (or '
        + 'non-TTY stdout) prints `{ "deleted": true, "sessionId": "<id>" }`.'
        + '\n\n'
        + 'Implemented CLI-side over the graph-db-server HTTP REST API '
        + '(`deleteSession` in graph-db-client); not a vt-daemon JSON-RPC '
        + 'tool, so there are no `(RPC: …)` mappings.',
    inputs: [
        {
            cliBulletLabel: '<id>',
            annotation: 'positional',
            description:
                'Required. The session id (UUID) to delete. Exactly one '
                + 'positional id is accepted.',
        },
        {
            cliBulletLabel: '--project VALUE',
            annotation: '',
            description: PROJECT_FLAG_DESCRIPTION,
        },
        {
            cliBulletLabel: '--json',
            annotation: '',
            description:
                'Emit `{ deleted: true, sessionId }` JSON instead of the '
                + '`Deleted Session: <id>` human line. Also triggered when '
                + 'stdout is not a TTY.',
        },
    ],
}

const VT_SESSION_SHOW_SPEC: ToolSpec = {
    cliVerb: 'vt session show',
    tier: 'reference',
    summary: 'Show metadata for a graph session.',
    description:
        'Show metadata for a graph session. Resolves the session id from the '
        + 'optional `[id]` positional, falling back to the `VT_SESSION` '
        + 'environment variable when no positional is supplied; if neither is '
        + 'set the command errors with guidance to pass `<id>` or set '
        + '`VT_SESSION`. Resolves the active project (from `--project` or '
        + 'upward `.voicetree/` discovery), auto-ensures the graph-db daemon, '
        + 'and issues `GET /sessions/<id>`. Returns a SessionInfo record with '
        + 'four fields: `id` (UUID), `lastAccessedAt` (integer epoch '
        + 'timestamp), `folderStateSize` (number of folder-state entries for '
        + 'the active view; 0 when no project root is resolved), and '
        + '`selectionSize` (count of selected node ids in the session). Note '
        + 'the field is `selectionSize` — there is no `collapseSetSize` field. '
        + 'Human output lists `Session ID`, `Last Accessed At`, '
        + '`Folder State Size`, and `Selection Size`, one per line; `--json` '
        + '(or non-TTY stdout) prints the raw SessionInfo JSON.\n\n'
        + 'Implemented CLI-side over the graph-db-server HTTP REST API '
        + '(`getSession` in graph-db-client); not a vt-daemon JSON-RPC tool, '
        + 'so there are no `(RPC: …)` mappings.',
    inputs: [
        {
            cliBulletLabel: '[id]',
            annotation: 'positional',
            description:
                'Optional session id (UUID) to show. When omitted, the id is '
                + 'read from the `VT_SESSION` environment variable. If neither '
                + 'the positional nor `VT_SESSION` is set, the command errors.',
        },
        {
            cliBulletLabel: 'VT_SESSION',
            annotation: 'env',
            description:
                'Fallback source for the session id when no `[id]` positional '
                + 'is given. A non-empty `VT_SESSION` value is used as the '
                + 'session id for `show`.',
        },
        {
            cliBulletLabel: '--project VALUE',
            annotation: '',
            description: PROJECT_FLAG_DESCRIPTION,
        },
        {
            cliBulletLabel: '--json',
            annotation: '',
            description:
                'Emit the raw SessionInfo JSON '
                + '(`{ id, lastAccessedAt, folderStateSize, selectionSize }`) '
                + 'instead of the four human-readable lines. Also triggered '
                + 'when stdout is not a TTY.',
        },
    ],
}

export const SESSION_SPECS: readonly ToolSpec[] = [
    VT_SESSION_CREATE_SPEC,
    VT_SESSION_DELETE_SPEC,
    VT_SESSION_SHOW_SPEC,
]
