/**
 * CLI-local doc-only tool specs for the `vt debug` family (part 2 of 2).
 *
 * Continuation of `debug-1.ts` — see that file's header for the full
 * description of the `vt debug` family (CDP/headful debugger, no daemon
 * RPC dispatch, source under packages/libraries/graph-tools/src/commands).
 * This file holds the remaining eight subcommands: ls, log, node,
 * node-click, page-ax, run, screenshot, and why-blank. Every input omits
 * `rpcName` (empty annotation) because no debug verb maps to an RPC.
 */

import type {ToolInputSpec, ToolSpec} from '../tool-spec-types.ts'

// ─── Shared selector descriptors (re-declared here to keep each split
// file self-contained; the wording matches debug-1.ts). ──────────────────────

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

const SELECTOR_INPUTS: readonly ToolInputSpec[] = [PORT_INPUT, PID_INPUT, PROJECT_INPUT, NEW_INPUT]
const SELECTOR_INPUTS_NO_NEW: readonly ToolInputSpec[] = [PORT_INPUT, PID_INPUT, PROJECT_INPUT]

// ─── ls ──────────────────────────────────────────────────────────────────────

const VT_DEBUG_LS_SPEC: ToolSpec = {
    cliVerb: 'vt debug ls',
    tier: 'reference',
    summary: 'List the live registered Voicetree dev instances (pid, projectRoot, cdpPort, startedAt), optionally filtered by selector.',
    description: 'List the live registered Voicetree dev instances (pid, projectRoot, cdpPort, startedAt), optionally filtered by selector.\n\n'
        + 'CLI-local; does not dispatch to a daemon RPC. Reads the instance JSON files from the Application Support `VoiceTree/instances` dir, keeps only those whose PID is still alive, and applies `--port`/`--cdpPort`, `--pid`, or `--project` (resolved-prefix match) filters. Returns the array as-is — it neither attaches over CDP nor auto-launches, making it the safe first call to discover what to target with `--port`. Does not accept `--new`.',
    inputs: [...SELECTOR_INPUTS_NO_NEW],
}

// ─── log ─────────────────────────────────────────────────────────────────────

const VT_DEBUG_LOG_SPEC: ToolSpec = {
    cliVerb: 'vt debug log',
    tier: 'reference',
    summary: 'Collect a diagnostic report from the dev session: page title/URL, loaded roots, recent console errors, uncaught exceptions, and the focused element\'s accessibility info.',
    description: 'Collect a diagnostic report from the dev session: page title/URL, loaded roots, recent console errors, uncaught exceptions, and the focused element\'s accessibility info.\n\n'
        + 'CLI-local; does not dispatch to a daemon RPC. Connects over CDP and combines the page title, the daemon live state\'s loaded roots, and a renderer snapshot from `window.__vtDebug__` (console messages + exceptions + active element). Returns recent console ERRORS (last 20) and uncaught exceptions (count plus last 10 sample), enriched with the focused element\'s accessibility role/name. `--since-ms N` filters console/exception entries to the last N milliseconds (entries with unparseable timestamps are kept). Accepts `--port`/`--cdpPort`/`--pid`/`--project` but NOT `--new`.',
    inputs: [
        {
            cliBulletLabel: '--since-ms VALUE',
            annotation: '',
            description: 'Filter console errors and uncaught exceptions to the last N milliseconds (entries with unparseable timestamps are kept). Also accepts `--since-ms=N`.',
        },
        ...SELECTOR_INPUTS_NO_NEW,
    ],
}

// ─── node ────────────────────────────────────────────────────────────────────

const VT_DEBUG_NODE_SPEC: ToolSpec = {
    cliVerb: 'vt debug node',
    tier: 'reference',
    summary: 'Inspect one graph node in the dev session — its on-disk content plus how it is rendered (Cytoscape presence, bbox, classes, focus) and its actionable buttons.',
    description: 'Inspect one graph node in the dev session — its on-disk content plus how it is rendered (Cytoscape presence, bbox, classes, focus) and its actionable buttons.\n\n'
        + 'CLI-local; does not dispatch to a daemon RPC. Resolves the instance, fetches the daemon live state, and looks up the node by id (its absolute file path). Errors `node not found: <id>` (exit 1) if absent. Then connects over CDP and takes a renderer snapshot: Cytoscape rendered/hidden/removed state, rendered bbox, classes, focus, and the node\'s editor floating window. Merges accessibility-tree buttons with the `window.__vtDebug__.buttons()` registry into a deduped button list. Requires a single `<id>` positional; accepts the shared selector flags including `--new`. Any other `--flag` errors `unknown flag: <flag>`.',
    inputs: [
        {
            cliBulletLabel: '<id>',
            annotation: 'positional',
            description: 'Node id (its absolute file path) to inspect. Required; errors `node not found` if absent from live state.',
        },
        ...SELECTOR_INPUTS,
    ],
}

// ─── node-click ──────────────────────────────────────────────────────────────

const VT_DEBUG_NODE_CLICK_SPEC: ToolSpec = {
    cliVerb: 'vt debug node-click',
    tier: 'reference',
    summary: 'Click a button on a node in the dev session by label or zero-based index, then report dispatched events, console output, and a screenshot.',
    description: 'Click a button on a node in the dev session by label or zero-based index, then report dispatched events, console output, and a screenshot.\n\n'
        + 'CLI-local; does not dispatch to a daemon RPC. Requires two positionals: `<id>` and `<label|index>`. Collects the node\'s buttons (accessibility tree + `__vtDebug__.buttons()` registry, merged), then selects by index (zero-based, range-checked) or by exact normalized label (ambiguous/missing label errors with the available-button list). Refuses a disabled button. Begins an event/console capture, clicks the real DOM element, waits a fixed settle interval, writes a full-page PNG to `/tmp/vt-debug/node-click/<ts>.png`, and ends capture. Returns `{nodeId, button, matchedBy, dispatchedEvents, consoleAfter, screenshotPath, pid, cdpPort}`. Accepts `--port`/`--cdpPort`/`--pid`/`--project` but NOT `--new`. Also reachable as the two-token form `vt debug node click`.',
    inputs: [
        {
            cliBulletLabel: '<id>',
            annotation: 'positional',
            description: 'Node id whose button to click. Required.',
        },
        {
            cliBulletLabel: '<label|index>',
            annotation: 'positional',
            description: 'Button reference: a zero-based integer index (range-checked) or an exact normalized button label (ambiguous/missing label errors with the available list). Required.',
        },
        ...SELECTOR_INPUTS_NO_NEW,
    ],
}

// ─── page-ax ─────────────────────────────────────────────────────────────────

const VT_DEBUG_PAGE_AX_SPEC: ToolSpec = {
    cliVerb: 'vt debug page-ax',
    tier: 'reference',
    summary: 'Dump the dev session\'s accessibility (AX) tree, optionally rooted at a CSS selector.',
    description: 'Dump the dev session\'s accessibility (AX) tree, optionally rooted at a CSS selector.\n\n'
        + 'CLI-local; does not dispatch to a daemon RPC. Connects over CDP and returns the Playwright accessibility snapshot of the first page with `interestingOnly: false` (the full tree). `--selector <css>` roots the snapshot at a specific element; an unmatched selector errors `selector not found: <selector>`, and an empty resulting tree errors with a hint to try `--selector` on a specific app root. Accepts the shared selector flags including `--new`. Also reachable as the two-token form `vt debug page ax`.',
    inputs: [
        {
            cliBulletLabel: '--selector VALUE',
            annotation: '',
            description: 'Root the accessibility snapshot at this CSS-selected element; an unmatched selector errors `selector not found`. Also accepts `--selector=CSS`.',
        },
        ...SELECTOR_INPUTS,
    ],
}

// ─── run ─────────────────────────────────────────────────────────────────────

const VT_DEBUG_RUN_SPEC: ToolSpec = {
    cliVerb: 'vt debug run',
    tier: 'reference',
    summary: 'Replay a scripted sequence of UI steps against the dev session and bundle per-step observations (screenshots, console, drift, state).',
    description: 'Replay a scripted sequence of UI steps against the dev session and bundle per-step observations (screenshots, console, drift, state).\n\n'
        + 'CLI-local; does not dispatch to a daemon RPC. Takes a `<spec-file|inline-json>` positional: a JSON array of `StepSpec`s (or `{steps:[...]}`), or a file path to one (a leading `[` or `{` is treated as inline JSON, otherwise as a path). Each validated step is one of `dispatch` (a live command sent through the daemon transport), `click <css>`, `tapNode <id>` (mouse-clicks the rendered node when on-screen, else emits a `tap`), `type` (+ optional `selector` focus), `press` (normalized chord, + optional `selector` focus), `wait <ms>`, `waitFor <css>` (+ `timeoutMs`), or `navigate <url>`. Per-step observation flags: `--screenshot-each`, `--console-each`, `--drift-each`, `--state-each`. `--stop-on-error[=true|false]` (default true) halts on the first failing step. `--out <dir>` sets the bundle dir (default a timestamped dir under `/tmp/vt-debug/run`). Returns `{source, bundle:{dir, stepCount, outputs}}`. An empty step list short-circuits successfully without attaching over CDP. Accepts `--port`/`--cdpPort`/`--pid`/`--project` but NOT `--new`.',
    inputs: [
        {
            cliBulletLabel: '<spec-file|inline-json>',
            annotation: 'positional',
            description: 'A StepSpec JSON array / `{steps:[...]}` object passed inline, or a path to such a file. Required.',
        },
        {
            cliBulletLabel: '--screenshot-each',
            annotation: '',
            description: 'Capture a screenshot after each step into the bundle dir.',
        },
        {
            cliBulletLabel: '--console-each',
            annotation: '',
            description: 'Capture renderer console output after each step.',
        },
        {
            cliBulletLabel: '--drift-each',
            annotation: '',
            description: 'Capture state/render drift after each step.',
        },
        {
            cliBulletLabel: '--state-each',
            annotation: '',
            description: 'Capture the serialized live state (delta-applied overlay) after each step.',
        },
        {
            cliBulletLabel: '--stop-on-error VALUE',
            annotation: '',
            description: 'Halt on the first failing step. Accepts `--stop-on-error` followed by `true`/`false`, or `--stop-on-error=true|false`. Default true.',
        },
        {
            cliBulletLabel: '--out VALUE',
            annotation: '',
            description: 'Bundle output directory (absolute-resolved; default a timestamped dir under `/tmp/vt-debug/run`). Also accepts `--out=DIR`.',
        },
        ...SELECTOR_INPUTS_NO_NEW,
    ],
}

// ─── screenshot ──────────────────────────────────────────────────────────────

const VT_DEBUG_SCREENSHOT_SPEC: ToolSpec = {
    cliVerb: 'vt debug screenshot',
    tier: 'reference',
    summary: 'Take a PNG screenshot of the dev session — the full page, or a single element by CSS selector — to a file and/or as base64.',
    description: 'Take a PNG screenshot of the dev session — the full page, or a single element by CSS selector — to a file and/or as base64.\n\n'
        + 'CLI-local; does not dispatch to a daemon RPC. Connects over CDP, waits up to 10s for the first page, and screenshots. `--selector <css>` screenshots just that element (and implicitly disables full-page); an unmatched selector errors `no element matches selector: <selector>`. `--full-page` forces full-page (the default when no selector is given). `--base64` returns the PNG inline as base64 (a file is still written too if `--out` is given). `-o`/`--out`/`--output PATH` sets the output path (absolute-resolved; default `/tmp/vt-debug/screenshots/<ts>.png`). Returns `{path?, base64?, selector?, fullPage, pid, cdpPort}`. Accepts the shared selector flags including `--new`.',
    inputs: [
        {
            cliBulletLabel: '--selector VALUE',
            annotation: '',
            description: 'Screenshot just this CSS-selected element (implicitly disables full-page). An unmatched selector errors. Also accepts `--selector=CSS`.',
        },
        {
            cliBulletLabel: '--full-page',
            annotation: '',
            description: 'Force a full-page screenshot (the default when no `--selector` is given).',
        },
        {
            cliBulletLabel: '--base64',
            annotation: '',
            description: 'Return the PNG inline as base64 (a file is still written if `--out` is also given).',
        },
        {
            cliBulletLabel: '-o / --out / --output VALUE',
            annotation: '',
            description: 'Output path (absolute-resolved; default `/tmp/vt-debug/screenshots/<ts>.png`). Also accepts `--out=PATH`, `--output=PATH`, `-o=PATH`.',
        },
        ...SELECTOR_INPUTS,
    ],
}

// ─── why-blank ───────────────────────────────────────────────────────────────

const VT_DEBUG_WHY_BLANK_SPEC: ToolSpec = {
    cliVerb: 'vt debug why-blank',
    tier: 'reference',
    summary: 'Diagnose why the dev session\'s UI is (or might be) blank, combining a screenshot byte-size probe, console/exceptions, live state counts, and root-DOM geometry.',
    description: 'Diagnose why the dev session\'s UI is (or might be) blank, combining a screenshot byte-size probe, console/exceptions, live state counts, and root-DOM geometry.\n\n'
        + 'CLI-local; does not dispatch to a daemon RPC. Connects over CDP and gathers a screenshot byte sample, renderer console/exceptions (`window.__vtDebug__`), a live-state summary (loaded roots, graph node count, projected node count), and `#root` DOM geometry (size, child count, display/visibility), then runs `diagnose` to classify the likely blank-screen cause. `--seed <scenario>` injects a synthetic failure sample for testing the diagnostics — valid scenarios: `throw-in-init`, `zero-height-root`, `empty-graph-no-roots`, `css-hidden-root`, `projected-empty`; an unknown seed errors with the valid list. Accepts the shared selector flags including `--new`. Also reachable as the two-token form `vt debug why blank`.',
    inputs: [
        {
            cliBulletLabel: '--seed VALUE',
            annotation: '',
            description: 'Inject a synthetic failure sample to exercise the diagnostics. Valid: `throw-in-init`, `zero-height-root`, `empty-graph-no-roots`, `css-hidden-root`, `projected-empty`. An unknown value errors with the valid list. Also accepts `--seed=SCENARIO`.',
        },
        ...SELECTOR_INPUTS,
    ],
}

export const DEBUG_SPECS_PART_2: readonly ToolSpec[] = [
    VT_DEBUG_LS_SPEC,
    VT_DEBUG_LOG_SPEC,
    VT_DEBUG_NODE_SPEC,
    VT_DEBUG_NODE_CLICK_SPEC,
    VT_DEBUG_PAGE_AX_SPEC,
    VT_DEBUG_RUN_SPEC,
    VT_DEBUG_SCREENSHOT_SPEC,
    VT_DEBUG_WHY_BLANK_SPEC,
]
