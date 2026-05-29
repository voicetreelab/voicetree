/**
 * CLI-local doc-only specs for the `vt graph` filesystem family:
 * `index`, `search`, `group`, `lint`, `rename`, and `mv`.
 *
 * Every verb here is implemented entirely CLI-side and does NOT dispatch
 * to a daemon RPC, so each spec omits the top-level `rpcName` and every
 * input uses an empty `annotation` with no `rpcName`.
 *
 * Two of these verbs are HONEST not-yet-available stubs:
 *   - `vt graph index` and `vt graph search` parse and validate their
 *     arguments for early failure, then exit non-zero with an explicit
 *     "not yet available" message. The backing semantic-search index is
 *     unimplemented (the backend writes no index / returns no hits), so
 *     they deliberately do NOT report a fake success. They are documented
 *     truthfully as unavailable, not as working.
 *
 * The mutating filesystem verbs (`group`, `rename`, `mv`) default their
 * project root to `~/brain` and support `--dry-run` and `--project`.
 *
 * Note: `vt search` (the daemon-backed `search_nodes` RPC) is a SEPARATE
 * verb that already lives in `TOOL_SPECS`; it is intentionally NOT
 * duplicated here.
 */

import type {ToolSpec} from '../tool-spec-types.ts'

const VT_GRAPH_INDEX_SPEC: ToolSpec = {
    cliVerb: 'vt graph index',
    tier: 'reference',
    summary: 'Build a local semantic search index for a project — not yet available.',
    description:
        'Build a local semantic search index for a project — not yet available.\n\n'
        + 'This is an honest stub. The backing semantic-search index is '
        + 'unimplemented: the backend `buildIndex` only logs a TODO and writes '
        + 'no index to disk. Rather than reporting a fake success or printing a '
        + 'non-existent index path, the CLI parses and validates its argument '
        + 'for early failure, then exits non-zero with an explicit '
        + '"not yet available" message — so an agent can tell "unimplemented" '
        + 'apart from "no matches".\n\n'
        + 'This verb is CLI-local and does not dispatch to a daemon RPC. When '
        + 'the semantic index lands this stub will be replaced; until then, use '
        + 'the top-level `vt search` command for the daemon-backed (also '
        + 'currently stubbed) search surface.',
    inputs: [
        {
            cliBulletLabel: '<project-root>',
            annotation: 'positional',
            description:
                'Absolute or relative path to the project whose graph would be '
                + 'indexed. Exactly one positional is required (no flags are '
                + 'accepted). Validated for early failure but currently unused — '
                + 'the command always exits non-zero with a "not yet available" '
                + 'error and builds no index.',
        },
    ],
}

const VT_GRAPH_SEARCH_SPEC: ToolSpec = {
    cliVerb: 'vt graph search',
    tier: 'reference',
    summary: 'Query a local semantic search index for a project — not yet available.',
    description:
        'Query a local semantic search index for a project — not yet available.\n\n'
        + 'This is an honest stub. The backing semantic-search index is '
        + 'unimplemented: the backend `search` returns an empty array for every '
        + 'query regardless of project contents, so emitting `hits: []` would be '
        + 'indistinguishable from a genuine no-match result. Instead the CLI '
        + 'parses and validates its arguments for early failure, then exits '
        + 'non-zero with an explicit "not yet available" message.\n\n'
        + 'This verb is CLI-local and does not dispatch to a daemon RPC. For the '
        + 'daemon-backed search surface use the top-level `vt search` command '
        + '(itself stubbed until vector search is wired up). Note that '
        + '`vt graph search` is a distinct local-index stub — it is not the same '
        + 'verb as `vt search`.',
    inputs: [
        {
            cliBulletLabel: '<project-root>',
            annotation: 'positional',
            description:
                'Absolute or relative path to the project to search (the first '
                + 'positional). Validated but currently unused.',
        },
        {
            cliBulletLabel: '<query>...',
            annotation: 'positional',
            description:
                'Natural-language query. All remaining positional tokens after '
                + 'the project root are joined with spaces. At least one query '
                + 'token is required (the command needs two or more positionals '
                + 'total). Validated but currently unused.',
        },
        {
            cliBulletLabel: '--top-k VALUE',
            annotation: '',
            description:
                'Maximum number of results to return (default `10`). Must be a '
                + 'positive integer. Parsed but currently unused — the command '
                + 'always fails with a "not yet available" error.',
        },
    ],
}

const VT_GRAPH_GROUP_SPEC: ToolSpec = {
    cliVerb: 'vt graph group',
    tier: 'reference',
    summary: 'Group existing node files into a folder and rewrite every reference to them.',
    description:
        'Group existing node files into a folder and rewrite every reference to '
        + 'them.\n\n'
        + 'Creates the target folder if it does not exist (recursively), moves '
        + 'each named node file into it (preserving basenames), then scans every '
        + '`.md` file under the project root and rewrites the `[[wikilink]]`, '
        + '`~/brain/...`, absolute-path, and bare relative-path references that '
        + 'point at the moved files so no link breaks.\n\n'
        + 'This verb is CLI-local and does not dispatch to a daemon RPC — it '
        + 'edits files directly on disk. The `.voicetree/` and `node_modules/` '
        + 'subtrees are skipped during the reference scan. It fails before '
        + 'moving anything if a source is missing, is not a file, or a '
        + 'destination basename already exists in the target folder. Use '
        + '`--dry-run` to preview the folder creation, moves, and reference '
        + 'rewrites without touching disk.',
    inputs: [
        {
            cliBulletLabel: '<folder-path>',
            annotation: 'positional',
            description:
                'Target folder to group the node files into; created recursively '
                + 'if absent. Accepts `~/brain/<rel>`, `~/<home-rel>`, an absolute '
                + 'path, or a path relative to the resolved project root.',
        },
        {
            cliBulletLabel: '<node...>',
            annotation: 'positional',
            description:
                'One or more node files to move into the folder. At least one '
                + 'node is required (the folder plus one or more nodes — i.e. two '
                + 'or more positionals total). Each must resolve to an existing '
                + 'file.',
        },
        {
            cliBulletLabel: '--dry-run',
            annotation: '',
            description:
                'Preview the folder creation, file moves, and reference rewrites '
                + 'without writing to disk.',
        },
        {
            cliBulletLabel: '--project VALUE',
            annotation: '',
            description:
                'Project root used to resolve relative inputs and to scope the '
                + 'reference-rewrite scan. Defaults to `~/brain`.',
        },
    ],
}

const VT_GRAPH_LINT_SPEC: ToolSpec = {
    cliVerb: 'vt graph lint',
    tier: 'reference',
    summary: 'Lint a graph folder for structural complexity violations and warnings.',
    description:
        'Lint a graph folder for structural complexity violations and '
        + 'warnings.\n\n'
        + "Takes a consistent snapshot of the named folder's nodes from the "
        + 'running graph daemon (so unsaved in-memory edits are reflected), '
        + 'materializes it to a temporary directory, and runs the structural '
        + 'rules in `@vt/graph-tools`: node arity / attention-item caps, '
        + 'high-coupling detection, and wide cross-reference detection, plus '
        + 'orphan and depth metrics.\n\n'
        + 'Prints a human-readable report by default; with the global `--json` '
        + 'flag it emits the machine-readable lint report instead. This verb is '
        + 'CLI-local and does not dispatch to a daemon RPC; the daemon '
        + "connection used for the snapshot is established automatically from "
        + "the folder's resolved project, so there is deliberately NO "
        + '`--project` or `--port` flag on this verb.',
    inputs: [
        {
            cliBulletLabel: '<folder-path>',
            annotation: 'positional',
            description:
                'Absolute or relative folder whose graph is linted (required). '
                + 'Resolved to an absolute path before the daemon snapshot is '
                + 'materialized.',
        },
        {
            cliBulletLabel: '--max-arity VALUE',
            annotation: '',
            description:
                'Maximum allowed node arity. Sets BOTH the arity cap and the '
                + 'max-attention-items cap to this value (they share one knob on '
                + 'the CLI).',
        },
        {
            cliBulletLabel: '--coupling-threshold VALUE',
            annotation: '',
            description:
                'Degree at or above which a node is flagged as highly coupled.',
        },
        {
            cliBulletLabel: '--cross-ref-threshold VALUE',
            annotation: '',
            description:
                'Cross-reference count at or above which a node is flagged as a '
                + 'wide cross-reference hub.',
        },
    ],
}

const VT_GRAPH_RENAME_SPEC: ToolSpec = {
    cliVerb: 'vt graph rename',
    tier: 'reference',
    summary: 'Rename a single node file and update every reference to it.',
    description:
        'Rename a single node file and update every reference to it.\n\n'
        + 'Renames one file from its old path to a new path, then scans every '
        + '`.md` file under the project root and rewrites `[[wikilink]]`, '
        + '`~/brain/...`, absolute-path, and bare relative-path references so '
        + 'links stay intact. Files only — passing a folder is rejected.\n\n'
        + 'This verb is CLI-local and does not dispatch to a daemon RPC. The '
        + '`.voicetree/` and `node_modules/` subtrees are skipped during the '
        + 'reference scan. It fails before renaming if the source is missing, '
        + 'the destination already exists, the target directory does not exist, '
        + 'or source and destination are the same path. Use `--dry-run` to '
        + 'preview.',
    inputs: [
        {
            cliBulletLabel: '<old-path>',
            annotation: 'positional',
            description:
                'Existing node file to rename. Must be a file (folders are '
                + 'rejected). Accepts `~/brain/<rel>`, `~/<home-rel>`, an absolute '
                + 'path, or a path relative to the resolved project root.',
        },
        {
            cliBulletLabel: '<new-path>',
            annotation: 'positional',
            description:
                'New path/name for the file. Its parent directory must already '
                + 'exist and the destination must not already exist.',
        },
        {
            cliBulletLabel: '--dry-run',
            annotation: '',
            description:
                'Preview the rename and reference rewrites without writing to '
                + 'disk.',
        },
        {
            cliBulletLabel: '--project VALUE',
            annotation: '',
            description:
                'Project root used to resolve relative inputs and to scope the '
                + 'reference-rewrite scan. Defaults to `~/brain`.',
        },
    ],
}

const VT_GRAPH_MV_SPEC: ToolSpec = {
    cliVerb: 'vt graph mv',
    tier: 'reference',
    summary: 'Move a node file or an entire folder and update every reference to it.',
    description:
        'Move a node file or an entire folder and update every reference to '
        + 'it.\n\n'
        + 'For a file it moves the single file; for a folder it moves all '
        + 'contained `.md` files (preserving their relative layout) and rewrites '
        + 'every `[[wikilink]]`, `~/brain/...`, absolute-path, and bare '
        + 'relative-path reference across the project so links stay intact. '
        + 'Non-Markdown files inside a moved folder are relocated too but are '
        + 'reported as a warning, since their references are not rewritten.\n\n'
        + 'This verb is CLI-local and does not dispatch to a daemon RPC. The '
        + '`.voicetree/` and `node_modules/` subtrees are skipped during the '
        + 'reference scan. It fails before moving if the source is missing, the '
        + 'destination already exists, the target directory does not exist, '
        + 'source equals destination, or the destination is inside the source '
        + 'folder. Use `--dry-run` to preview.',
    inputs: [
        {
            cliBulletLabel: '<source-path>',
            annotation: 'positional',
            description:
                'Existing file or folder to move. Accepts `~/brain/<rel>`, '
                + '`~/<home-rel>`, an absolute path, or a path relative to the '
                + 'resolved project root.',
        },
        {
            cliBulletLabel: '<dest-path>',
            annotation: 'positional',
            description:
                'Destination path. Its parent directory must already exist and '
                + 'the destination must not already exist; a folder destination '
                + 'may not be a descendant of the source.',
        },
        {
            cliBulletLabel: '--dry-run',
            annotation: '',
            description:
                'Preview the move(s) and reference rewrites without writing to '
                + 'disk.',
        },
        {
            cliBulletLabel: '--project VALUE',
            annotation: '',
            description:
                'Project root used to resolve relative inputs and to scope the '
                + 'reference-rewrite scan. Defaults to `~/brain`.',
        },
    ],
}

export const GRAPH_FS_SPECS: readonly ToolSpec[] = [
    VT_GRAPH_INDEX_SPEC,
    VT_GRAPH_SEARCH_SPEC,
    VT_GRAPH_GROUP_SPEC,
    VT_GRAPH_LINT_SPEC,
    VT_GRAPH_RENAME_SPEC,
    VT_GRAPH_MV_SPEC,
]
