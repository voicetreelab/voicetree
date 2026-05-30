/**
 * CLI-local doc-only tool specs for the `vt debug` family (part 1 of 2).
 *
 * The `vt debug` family is a headful, Chrome-DevTools-Protocol (CDP)
 * debugger for a running, UNPACKAGED Voicetree dev (Electron) session.
 * `vt debug <command>` shells out to the `vt-debug` bin
 * (packages/libraries/graph-tools/bin/vt-debug.ts) via `runDebugCommand`;
 * every argument is passed through unchanged with a 60s subprocess
 * timeout. None of these verbs dispatch to a daemon JSON-RPC — they all
 * connect over CDP to the live renderer instead, so each spec omits the
 * top-level `rpcName` and every input omits `rpcName` (empty annotation).
 *
 * Accuracy note: the debug family is CDP/headful, so functional
 * verification of the live behavior is deferred. These docs are authored
 * from the bin help text and the command handlers under
 * packages/libraries/graph-tools/src/commands/.
 *
 * This file holds the parent verb plus the first eight subcommands;
 * `debug-2.ts` holds the rest. `debug.ts` concatenates both into
 * `DEBUG_SPECS`.
 */

import type {ToolInputSpec, ToolSpec} from '../tool-spec-types.ts'

// ─── Shared input descriptors ────────────────────────────────────────────────
// Every CDP-backed command resolves a target dev instance with the same
// selector flags via `resolveDebugInstance` / `extractSelectorFlags`.

const PORT_INPUT: ToolInputSpec = {
    cliBulletLabel: '--port / --cdpPort VALUE',
    annotation: '',
    description: 'Shared selector. Target a specific registered dev session by its CDP port, matched against the instance\'s `cdpPort`. `--cdpPort` is a backward-compatible alias for `--port`. Also accepts the `--port=N` / `--cdpPort=N` form.',
}

const PID_INPUT: ToolInputSpec = {
    cliBulletLabel: '--pid VALUE',
    annotation: '',
    description: 'Shared selector. Target a specific registered dev process by pid. Also accepts the `--pid=N` form.',
}

const PROJECT_INPUT: ToolInputSpec = {
    cliBulletLabel: '--project VALUE',
    annotation: '',
    description: 'Shared selector. Target a registered dev session whose resolved `projectRoot` matches the given path (prefix match). Also accepts the `--project=PATH` form.',
}

const NEW_INPUT: ToolInputSpec = {
    cliBulletLabel: '--new',
    annotation: '',
    description: 'Shared selector. Launch a fresh dev session even if one already exists (preferred when testing new code). Accepted by attach, capture, drift, eval, keyboard, node, page-ax, screenshot, and why-blank; NOT accepted by ls, log, folder-aspect, folder-materialize, node-click, or run.',
}

// Commands that DO honor --new.
const SELECTOR_INPUTS: readonly ToolInputSpec[] = [PORT_INPUT, PID_INPUT, PROJECT_INPUT, NEW_INPUT]
// Commands that resolve an existing instance only (no --new).
const SELECTOR_INPUTS_NO_NEW: readonly ToolInputSpec[] = [PORT_INPUT, PID_INPUT, PROJECT_INPUT]

// ─── Parent verb ─────────────────────────────────────────────────────────────

const VT_DEBUG_SPEC: ToolSpec = {
    cliVerb: 'vt debug',
    tier: 'reference',
    summary: 'Headful/CDP debugger for a running Voicetree dev (Electron) session — inspect, drive, and snapshot the live UI from the CLI.',
    description: 'Headful/CDP debugger for a running Voicetree dev (Electron) session — inspect, drive, and snapshot the live UI from the CLI.\n\n'
        + 'This verb is CLI-local: it does not dispatch to a daemon RPC. `vt debug <command> [args]` shells out to the `vt-debug` bin (`packages/libraries/graph-tools/bin/vt-debug.ts`) via `runDebugCommand`; every argument is passed through unchanged with a 60s subprocess timeout. Each subcommand lives in `src/commands/<area>/*.ts` and self-registers into `commandRegistry` via `registerCommand`. These are NOT daemon-tool-catalog verbs — they connect over the Chrome DevTools Protocol (CDP) to a live, unpackaged Electron dev session, so they have no JSON-RPC binding and are not exposed through the daemon. Functional verification of CDP behavior is deferred (headful-only); this documentation is authored from the bin help text and the command handlers.\n\n'
        + '**Two-token aliases.** `vt debug folder aspect`, `vt debug folder materialize`, `vt debug node click`, `vt debug page ax`, and `vt debug why blank` are collapsed to their hyphenated registry keys by `resolveCommand` (it tries `<first>-<second>` against the registry first), so either spelling works.\n\n'
        + '**Instance selection** (shared across all CDP-backed commands): a session is chosen by `resolveDebugInstance` from the registered dev instances (instance JSON files under the Application Support `VoiceTree/instances` dir, filtered to live PIDs). Filter precedence is `--port` > `--pid` > `--project` > single-live > ambiguous. When an explicit selector is given the target\'s CDP `/json/version` endpoint must be live or the command fails with exit 2.\n\n'
        + '**Auto-launch.** With NO selector and an existing dev session, `vt-debug` does not guess — it returns exit 2 and asks you to pass `--port <N>` to reuse it or `--new` to launch fresh. With no session at all it allocates a free localhost port and auto-launches `npm --prefix webapp run electron:debug` (env `ENABLE_PLAYWRIGHT_DEBUG=1`, `PLAYWRIGHT_MCP_CDP_ENDPOINT=http://127.0.0.1:<port>`, `VT_DEBUG_AUTOLAUNCHED=1`), waits up to 30s for the session to register a live CDP endpoint, and prints the chosen port to stderr (`re-run with --port <N> for future commands`). Only unpackaged dev sessions with a live `/json/version` endpoint are considered; packaged production builds are ignored.\n\n'
        + '**Help.** `vt debug` / `vt debug --help` / `vt debug -h` / `vt debug help` print the top-level usage (shared selector flags, auto-launch notes, and the sorted command list) and exit 0. `vt debug <command> --help` (or `-h`) short-circuits BEFORE dispatch — it prints that command\'s usage and the shared selector flags and exits 0 WITHOUT invoking the handler, so help never triggers `resolveDebugInstance` and therefore never auto-launches Electron.\n\n'
        + '**Output.** Results are emitted as a single JSON `Response` object on stdout (`{ok, command, ...}`); errors print `{ok:false, command, error, hint?}` on stderr. Exit codes: 0 ok, 1 command failure, 2 instance discovery/selection, 3 CDP connect/eval failure.',
    inputs: [
        PORT_INPUT,
        PID_INPUT,
        PROJECT_INPUT,
        NEW_INPUT,
        {
            cliBulletLabel: '--help / -h',
            annotation: '',
            description: 'On the bare `vt debug` prints top-level usage and exits 0. After a subcommand (`vt debug <command> --help`) prints that command\'s usage plus the shared selector flags and exits 0 WITHOUT dispatching the handler, so it never auto-launches Electron.',
        },
    ],
}

// ─── attach ──────────────────────────────────────────────────────────────────

const VT_DEBUG_ATTACH_SPEC: ToolSpec = {
    cliVerb: 'vt debug attach',
    tier: 'reference',
    summary: 'Attach to a running dev session over CDP and report its primary page title, URL, tab count, pid, and CDP port.',
    description: 'Attach to a running dev session over CDP and report its primary page title, URL, tab count, pid, and CDP port.\n\n'
        + 'CLI-local; does not dispatch to a daemon RPC. Resolves a dev instance (shared selector flags), opens a Playwright CDP session, reads the first page, and returns `{pageTitle, url, tabs, pid, cdpPort}`. This is the connectivity smoke test for the debugger: if CDP connect fails it hints `Is ENABLE_PLAYWRIGHT_DEBUG=1 set and Voicetree running in dev mode?` and exits 3. Takes no positional arguments.',
    inputs: [...SELECTOR_INPUTS],
}

// ─── capture ─────────────────────────────────────────────────────────────────

const VT_DEBUG_CAPTURE_SPEC: ToolSpec = {
    cliVerb: 'vt debug capture',
    tier: 'reference',
    summary: 'Capture a full live-state snapshot (serialized daemon state + Cytoscape dump + focused element) of a dev session to a JSON file.',
    description: 'Capture a full live-state snapshot (serialized daemon state + Cytoscape dump + focused element) of a dev session to a JSON file.\n\n'
        + 'CLI-local; does not dispatch to a daemon RPC. Connects over CDP and concurrently reads the daemon live state (via the project\'s live transport), the renderer\'s `window.__vtDebug__.cy()` Cytoscape dump, and the focused DOM element. Writes a `Snapshot` (`{state, cyDump, focused, selection, zoom, pan, timestamp}`) as pretty JSON and returns `{path, timestamp}`. Output path precedence: `--out PATH` (absolute-resolved) wins; else `--tag NAME` writes `/tmp/vt-debug/captures/<sanitized-tag>.json`; else a timestamped file under `/tmp/vt-debug/captures/`. Pairs with `vt debug diff`.',
    inputs: [
        {
            cliBulletLabel: '--tag VALUE',
            annotation: '',
            description: 'Write the snapshot to `/tmp/vt-debug/captures/<sanitized-tag>.json` (non-`[a-zA-Z0-9._-]` runs collapsed to `-`). Ignored when `--out` is given. Also accepts `--tag=NAME`.',
        },
        {
            cliBulletLabel: '-o / --out VALUE',
            annotation: '',
            description: 'Absolute-resolved output path for the snapshot JSON. Overrides `--tag` and the default timestamped path. Also accepts `--out=PATH`.',
        },
        ...SELECTOR_INPUTS,
    ],
}

// ─── diff ────────────────────────────────────────────────────────────────────

const VT_DEBUG_DIFF_SPEC: ToolSpec = {
    cliVerb: 'vt debug diff',
    tier: 'reference',
    summary: 'Diff two previously captured snapshots and report what changed between them (no live app required).',
    description: 'Diff two previously captured snapshots and report what changed between them (no live app required).\n\n'
        + 'CLI-local; does not dispatch to a daemon RPC. This is the only debug verb that never touches CDP — it is a pure file operation, so it runs without a live dev session and accepts no selector flags. Reads two snapshots and returns `diffCaptures(a, b)`. Each positional resolves first as a direct path, then as a tagged capture under `/tmp/vt-debug/captures/<name>.json` (the `.json` suffix is optional). Requires exactly two positionals; with fewer it errors `usage: diff <snapshot-a> <snapshot-b>`. A missing snapshot errors `snapshot not found: <input>`.',
    inputs: [
        {
            cliBulletLabel: '<snapshot-a>',
            annotation: 'positional',
            description: 'First snapshot: a direct path, or a tag resolved under `/tmp/vt-debug/captures/<name>.json` (`.json` optional). Required.',
        },
        {
            cliBulletLabel: '<snapshot-b>',
            annotation: 'positional',
            description: 'Second snapshot, resolved the same way. Required. No CDP connection or selector flags — pure file diff.',
        },
    ],
}

// ─── drift ───────────────────────────────────────────────────────────────────

const VT_DEBUG_DRIFT_SPEC: ToolSpec = {
    cliVerb: 'vt debug drift',
    tier: 'reference',
    summary: 'Detect drift between the daemon\'s live state, the projected Cytoscape dump, and what Cytoscape actually rendered in the dev session.',
    description: 'Detect drift between the daemon\'s live state, the projected Cytoscape dump, and what Cytoscape actually rendered in the dev session.\n\n'
        + 'CLI-local; does not dispatch to a daemon RPC. Connects over CDP, fetches the daemon live state and the rendered `window.__vtDebug__.cy()` dump, projects the live state to a Cytoscape dump, and computes drift across the three. `--deep` additionally snapshots each node\'s on-disk file content (read from the node id, which is its absolute file path) so the diff can compare filesystem vs. state. Accepts the shared selector flags including `--new`; any unrecognized argument errors `unknown arg: <arg>`.',
    inputs: [
        {
            cliBulletLabel: '--deep',
            annotation: '',
            description: 'Also snapshot each node\'s on-disk file content so the diff compares filesystem vs. live state, not just projected vs. rendered.',
        },
        ...SELECTOR_INPUTS,
    ],
}

// ─── eval ────────────────────────────────────────────────────────────────────

const VT_DEBUG_EVAL_SPEC: ToolSpec = {
    cliVerb: 'vt debug eval',
    tier: 'reference',
    summary: 'Evaluate an arbitrary JavaScript expression in the dev session\'s renderer and return a deeply-serialized result.',
    description: 'Evaluate an arbitrary JavaScript expression in the dev session\'s renderer and return a deeply-serialized result.\n\n'
        + 'CLI-local; does not dispatch to a daemon RPC. Connects over CDP and runs the given JS in the first page (awaited, so async expressions resolve). The result is walked by an injected serializer that handles circular refs (`[Circular]`), DOM nodes (`<tag#id.class>`), Date/RegExp/Error/Map/Set, and class instances. The expression is all trailing positional tokens joined by spaces; use a leading `--` to pass an expression that itself starts with `--`. Accepts the shared selector flags including `--new`. A missing expression errors with a usage hint; an unknown flag before `--` errors `unknown argument: <arg>` (hint: `use -- before expressions that start with --`).',
    inputs: [
        {
            cliBulletLabel: '<js>...',
            annotation: 'positional',
            description: 'JavaScript expression evaluated in the renderer; all trailing positional tokens are joined with spaces and awaited. Required.',
        },
        {
            cliBulletLabel: '--',
            annotation: '',
            description: 'Marks the end of flags; everything after is treated as the expression. Use when the expression itself starts with `--`.',
        },
        ...SELECTOR_INPUTS,
    ],
}

// ─── folder-aspect ───────────────────────────────────────────────────────────

const VT_DEBUG_FOLDER_ASPECT_SPEC: ToolSpec = {
    cliVerb: 'vt debug folder-aspect',
    tier: 'reference',
    summary: 'Compute folder-aspect-ratio diagnostics from the dev session\'s rendered Cytoscape dump (which folders are too cramped or sprawling).',
    description: 'Compute folder-aspect-ratio diagnostics from the dev session\'s rendered Cytoscape dump (which folders are too cramped or sprawling).\n\n'
        + 'CLI-local; does not dispatch to a daemon RPC. Connects over CDP, reads the rendered `window.__vtDebug__.cy()` dump, and runs `computeFolderAspects`. `--threshold N` (default 3, accepts a float) sets the aspect-ratio threshold; `--min-children N` (default 3, integer) sets the minimum child count for a folder to be considered. Accepts `--port`/`--cdpPort`/`--pid`/`--project` but NOT `--new` (it resolves an existing instance without forcing a fresh launch). Also reachable as the two-token form `vt debug folder aspect`. Unknown args error with the supported-flags hint.',
    inputs: [
        {
            cliBulletLabel: '--threshold VALUE',
            annotation: '',
            description: 'Aspect-ratio threshold (float, default 3). Also accepts `--threshold=N`.',
        },
        {
            cliBulletLabel: '--min-children VALUE',
            annotation: '',
            description: 'Minimum child count for a folder to be considered (integer, default 3). Also accepts `--min-children=N`.',
        },
        ...SELECTOR_INPUTS_NO_NEW,
    ],
}

// ─── folder-materialize ──────────────────────────────────────────────────────

const VT_DEBUG_FOLDER_MATERIALIZE_SPEC: ToolSpec = {
    cliVerb: 'vt debug folder-materialize',
    tier: 'reference',
    summary: 'Drive the dev session to materialize a folder\'s editor — seed a scratch fixture, tap the folder, type a marker, and probe the resulting DOM/editor state.',
    description: 'Drive the dev session to materialize a folder\'s editor — seed a scratch fixture, tap the folder, type a marker, and probe the resulting DOM/editor state.\n\n'
        + 'CLI-local; does not dispatch to a daemon RPC. An end-to-end interaction harness: connects over CDP, waits for the graph to be ready, creates a scratch fixture (or targets `--folder <absolute-folder-id>`), taps the folder node, types `--marker <text>`, and probes Cytoscape node count plus floating-editor rects before/after the tap and after typing. Returns a rich result including saved content preview, editor selector/window id, fixture and cleanup status, pid, cdpPort, and projectRoot. `--timeout-ms N` (must be > 0; defaults to the implementation\'s DEFAULT_TIMEOUT_MS) bounds the graph-ready wait; `--keep-fixture` skips fixture cleanup. Accepts `--port`/`--cdpPort`/`--pid`/`--project` but NOT `--new`. Also reachable as the two-token form `vt debug folder materialize`.',
    inputs: [
        {
            cliBulletLabel: '--folder VALUE',
            annotation: '',
            description: 'Target an existing folder by absolute id (path-resolved, trailing-slash normalized) instead of seeding a scratch fixture. Also accepts `--folder=PATH`.',
        },
        {
            cliBulletLabel: '--marker VALUE',
            annotation: '',
            description: 'Text typed into the materialized editor and used to assert saved content. Also accepts `--marker=TEXT`.',
        },
        {
            cliBulletLabel: '--timeout-ms VALUE',
            annotation: '',
            description: 'Graph-ready wait bound in ms (must be > 0; defaults to the implementation\'s DEFAULT_TIMEOUT_MS). Also accepts `--timeout-ms=N`.',
        },
        {
            cliBulletLabel: '--keep-fixture',
            annotation: '',
            description: 'Skip cleanup of the seeded scratch fixture.',
        },
        ...SELECTOR_INPUTS_NO_NEW,
    ],
}

// ─── keyboard ────────────────────────────────────────────────────────────────

const VT_DEBUG_KEYBOARD_SPEC: ToolSpec = {
    cliVerb: 'vt debug keyboard',
    tier: 'reference',
    summary: 'Send keyboard input (typed text or a normalized key chord) to the dev session\'s renderer, optionally focusing a selector first.',
    description: 'Send keyboard input (typed text or a normalized key chord) to the dev session\'s renderer, optionally focusing a selector first.\n\n'
        + 'CLI-local; does not dispatch to a daemon RPC. Requires an operation positional: `type <text>` or `press <chord>`.\n\n'
        + '`type`: types the joined positional text into the page; `--selector <css>` focuses that element first; `--delay-ms N` (>= 0) adds per-keystroke delay. Returns the active element after typing.\n\n'
        + '`press`: presses exactly one chord (e.g. `Mod+Enter`), normalized via `normalizeChord`; `--selector <css>` focuses first. Returns the active element and the normalized chord.\n\n'
        + 'Both ops accept the shared selector flags including `--new`. A missing/invalid operation, missing text, or a non-single press chord all return the usage error.',
    inputs: [
        {
            cliBulletLabel: '<type|press>',
            annotation: 'positional',
            description: 'Required operation. `type` types text; `press` presses one key chord.',
        },
        {
            cliBulletLabel: '<text>... | <chord>',
            annotation: 'positional',
            description: 'For `type`: the text to type (all positionals joined with spaces). For `press`: exactly one key chord (e.g. `Mod+Enter`), normalized before dispatch. Required.',
        },
        {
            cliBulletLabel: '--selector VALUE',
            annotation: '',
            description: 'Focus this CSS-selected element before typing/pressing. Also accepts `--selector=CSS`.',
        },
        {
            cliBulletLabel: '--delay-ms VALUE',
            annotation: '',
            description: '`type` only: per-keystroke delay in ms (must be >= 0). Also accepts `--delay-ms=N`.',
        },
        ...SELECTOR_INPUTS,
    ],
}

export const DEBUG_SPECS_PART_1: readonly ToolSpec[] = [
    VT_DEBUG_SPEC,
    VT_DEBUG_ATTACH_SPEC,
    VT_DEBUG_CAPTURE_SPEC,
    VT_DEBUG_DIFF_SPEC,
    VT_DEBUG_DRIFT_SPEC,
    VT_DEBUG_EVAL_SPEC,
    VT_DEBUG_FOLDER_ASPECT_SPEC,
    VT_DEBUG_FOLDER_MATERIALIZE_SPEC,
    VT_DEBUG_KEYBOARD_SPEC,
]
