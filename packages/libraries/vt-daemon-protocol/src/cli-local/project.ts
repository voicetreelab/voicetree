/**
 * CLI-local doc-only tool specs for the `vt project` verb family.
 *
 * `vt project` is dispatched locally inside `voicetree-cli`
 * (`commands/runtime/project.ts` → `runProjectCommand`), which talks to the
 * project's graph daemon over HTTP via `@vt/graph-db-client`
 * (`ensureDaemon` + `GraphDbClient.getProject` / `setWriteFolderPath`). It
 * does NOT route through the daemon tool catalog, so these specs are
 * documentation-only: they carry no top-level `rpcName`, and each input
 * carries an empty `annotation` with no `rpcName`.
 *
 * Both verbs auto-launch and discover the project's graph daemon via
 * `ensureDaemon(project)` — there is intentionally no `--port` flag. The
 * project is resolved from `--project <path>` (or `--project=<path>`), else
 * by walking up from the current working directory for a `.voicetree/`
 * marker.
 */

import type {ToolSpec} from '../tool-spec-types.ts'

const PROJECT_FLAG_INPUT = {
    cliBulletLabel: '--project VALUE',
    annotation: '',
    description:
        'Override the resolved project path. Accepts `--project <path>` or '
        + '`--project=<path>`; the path must contain a `.voicetree/` directory. '
        + 'Defaults to the project detected by walking up from the current '
        + 'working directory.',
} as const

const SESSION_FLAG_INPUT = {
    cliBulletLabel: '--session VALUE',
    annotation: '',
    description:
        'Accepted (as `--session <id>` or `--session=<id>`) and validated to '
        + 'require a non-empty value, but currently a no-op: the project verbs '
        + 'resolve the daemon by project path only and never thread a session '
        + 'id into any request.',
} as const

const HELP_FLAG_INPUT = {
    cliBulletLabel: '--help / -h',
    annotation: '',
    description: 'Print the `vt project` usage and exit.',
} as const

export const VT_PROJECT_SHOW_SPEC: ToolSpec = {
    cliVerb: 'vt project show',
    tier: 'reference',
    summary:
        "Show the active project's resolved paths: project root, read paths, "
        + 'and write folder path.',
    description: [
        "Show the active project's resolved paths: project root, read paths, "
            + 'and write folder path.',
        '',
        'Resolves the project (via `--project <path>` or by walking up from the '
            + 'current working directory for a `.voicetree/` marker), ensures its '
            + 'graph daemon is running (`ensureDaemon` auto-launches the daemon and '
            + 'discovers its port), and fetches the daemon’s `ProjectState` over '
            + '`GET /project`.',
        '',
        '**Output (human):** three lines — `Project Path: <projectRoot>`, a '
            + '`Read Paths:` block (one `  - <path>` per read path, or `  (none)` '
            + 'when empty), and `Write Path: <writeFolderPath>`.',
        '',
        '**Output (`--json`):** the raw `ProjectState` object '
            + '`{projectRoot, readPaths, writeFolderPath}`, pretty-printed.',
        '',
        'This verb is CLI-local: it is implemented by the CLI against '
            + '`@vt/graph-db-client` and does NOT dispatch through the daemon tool '
            + 'catalog, so there is no JSON-RPC `vt`-tool wrapper for it (the '
            + 'corresponding daemon surface is the HTTP route `GET /project`).',
    ].join('\n'),
    inputs: [
        PROJECT_FLAG_INPUT,
        SESSION_FLAG_INPUT,
        {
            cliBulletLabel: '--json',
            annotation: '',
            description:
                'Emit the raw `ProjectState` object '
                + '(`{projectRoot, readPaths, writeFolderPath}`) as pretty-printed '
                + 'JSON instead of the human-readable lines.',
        },
        HELP_FLAG_INPUT,
    ],
}

export const VT_PROJECT_SET_WRITE_PATH_SPEC: ToolSpec = {
    cliVerb: 'vt project set-write-path',
    tier: 'reference',
    summary:
        "Set the project's write folder path — the folder where newly "
        + 'created nodes are written.',
    description: [
        "Set the project's write folder path — the folder where newly "
            + 'created nodes are written.',
        '',
        'The `<path>` positional is resolved to an absolute path and must live '
            + 'inside the resolved project root. The containment check runs '
            + 'CLI-side and fails fast with a clear message before any daemon call, '
            + 'so an out-of-project write path (e.g. `/tmp`) is rejected and never '
            + 'reaches the daemon. On success the CLI ensures the project’s graph '
            + 'daemon is running, issues `PUT /project/write-path`, and re-reads the '
            + 'resulting state.',
        '',
        '**Output (human):** a single line — `Write Path: <writeFolderPath>`.',
        '',
        '**Output (`--json`):** `{"writeFolderPath": <path>}` — the write '
            + 'path only, NOT the full `ProjectState` that `vt project show --json` '
            + 'emits.',
        '',
        'This verb is CLI-local: it is implemented by the CLI against '
            + '`@vt/graph-db-client` and does NOT dispatch through the daemon tool '
            + 'catalog, so there is no JSON-RPC `vt`-tool wrapper for it (the '
            + 'corresponding daemon surface is the HTTP route '
            + '`PUT /project/write-path`).',
    ].join('\n'),
    inputs: [
        {
            cliBulletLabel: '<path>',
            annotation: 'positional',
            description:
                'The new write folder path. Resolved to an absolute path and '
                + 'required to live inside the project root — containment is '
                + 'enforced CLI-side and fails fast before any daemon call.',
        },
        PROJECT_FLAG_INPUT,
        SESSION_FLAG_INPUT,
        {
            cliBulletLabel: '--json',
            annotation: '',
            description:
                'Emit `{"writeFolderPath": <path>}` as pretty-printed JSON '
                + 'instead of the human-readable `Write Path:` line.',
        },
        HELP_FLAG_INPUT,
    ],
}

export const PROJECT_SPECS: readonly ToolSpec[] = [
    VT_PROJECT_SHOW_SPEC,
    VT_PROJECT_SET_WRITE_PATH_SPEC,
]
