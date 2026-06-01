/**
 * CLI-local doc-only specs for the top-level `vt` verbs that are handled
 * entirely inside `voicetree-cli` and do NOT dispatch to a daemon JSON-RPC
 * tool: `vt serve`, `vt manual`, and `vt help`.
 *
 *   - `vt serve` (`commands/runtime/serve.ts` → `runServeCommand`) is a
 *     foreground two-ensure wrapper that brings up both per-project daemons
 *     (vt-graphd then vt-daemon) via the owner-aware ensure clients and then
 *     idles the process. It talks to the ensure machinery directly, not to
 *     the daemon tool catalog.
 *   - `vt manual` (`commands/manual.ts` → `runManualCommand`) renders the
 *     canonical CLI manual from in-process `MANUAL_SPECS` data; it performs
 *     no I/O and dispatches nowhere.
 *   - `vt help` (`voicetree-cli.ts` → `printHelp`) prints the top-level
 *     usage banner; it is pure stdout.
 *
 * Each spec therefore omits the top-level `rpcName`, and every input omits
 * `rpcName` with an empty `annotation` (no RPC mapping exists).
 */

import type {ToolSpec} from '../tool-spec-types.ts'

const VT_SERVE_SPEC: ToolSpec = {
    cliVerb: 'vt serve',
    tier: 'reference',
    summary:
        'Start the per-project daemons (graph-db + vt-daemon) in the '
        + 'foreground and idle until interrupted.',
    description: [
        'Start the per-project daemons (graph-db + vt-daemon) in the '
            + 'foreground and idle until interrupted. A convenience launcher '
            + 'that ensures both cross-process owner daemons for a project are '
            + 'running, prints where each landed, then parks the process so the '
            + 'operator’s terminal stays attached.',
        '',
        '**Ensure ordering:** graph-db is ensured first via '
            + '`ensureGraphDaemonForProject` (honouring `$VT_GRAPHD_BIN`), then '
            + 'vt-daemon via the high-level `ensureNodeVtDaemonForProject` entry '
            + '(honouring `$VT_DAEMON_BIN`). Each ensure either launches a fresh '
            + 'owner or reuses an existing one; the success line reports '
            + '`launched` vs `reused` for each, with the graph-db URL/pid, the '
            + 'vt-daemon base URL/pid, and the resolved project path.',
        '',
        '**Ownership:** neither daemon is owned by `vt serve` — both are '
            + 'cross-process resources spawned (or reused) under the spawn-lock '
            + 'single-flight ensure protocol, and `vt serve` is a transient peer '
            + 'of both. On `SIGINT`/`SIGTERM` it clears its idle timer and exits '
            + '`0` WITHOUT tearing down either daemon: other CLI peers and the '
            + 'Electron Main may still be using them, and each daemon’s own '
            + 'watchdog handles eventual shutdown. Stop a daemon explicitly via '
            + 'its `/shutdown` endpoint or by terminating its recorded owner pid.',
        '',
        '**Failure teardown:** if the graph-db ensure succeeds and the '
            + 'subsequent vt-daemon ensure then fails, the graph-db daemon this '
            + 'invocation just launched has no other peer, so it is torn down via '
            + 'its `/shutdown` endpoint (best-effort; a `/shutdown` that itself '
            + 'fails does not mask the original error) before exiting non-zero. A '
            + 'graph-db owner that was merely reused belongs to other peers and '
            + 'is left running.',
        '',
        'This verb is CLI-local: it drives the ensure clients '
            + '(`@vt/graph-db-client`, `@vt/vt-daemon-client`) directly and does '
            + 'NOT dispatch through the daemon tool catalog, so there are no '
            + '`(RPC: …)` parameter mappings.',
    ].join('\n'),
    inputs: [
        {
            cliBulletLabel: '--project VALUE',
            annotation: '',
            description:
                'Required. The project root to serve. Accepts '
                + '`--project <path>` or `--project=<path>`; the path is resolved '
                + 'to an absolute path. Missing or empty `--project` is a fatal '
                + 'usage error.',
        },
        {
            cliBulletLabel: '--exclusive',
            annotation: '',
            description:
                'Require this invocation to be the one that launches each '
                + 'daemon — refuse to reuse an existing owner. If a graph-db or '
                + 'vt-daemon owner already exists for the project, the command '
                + 'errors with the existing owner’s pid and port and asks you to '
                + 'stop it first. A vt-daemon refusal still tears down any '
                + 'graph-db daemon this invocation freshly launched, so the '
                + 'refusal does not orphan it.',
        },
        {
            cliBulletLabel: '--help / -h',
            annotation: '',
            description:
                'Print the `vt serve` usage line '
                + '(`Usage: vt serve --project <path> [--exclusive]`) and exit '
                + '`0`.',
        },
        {
            cliBulletLabel: 'VT_GRAPHD_BIN',
            annotation: 'env',
            description:
                'Optional override for the graph-db daemon binary passed to '
                + '`ensureGraphDaemonForProject`. When unset the ensure client '
                + 'resolves its default binary.',
        },
        {
            cliBulletLabel: 'VT_DAEMON_BIN',
            annotation: 'env',
            description:
                'Optional override for the vt-daemon binary passed to '
                + '`ensureNodeVtDaemonForProject`. When unset the ensure client '
                + 'resolves its default binary.',
        },
    ],
}

const VT_MANUAL_SPEC: ToolSpec = {
    cliVerb: 'vt manual',
    tier: 'reference',
    summary:
        'Print the canonical CLI manual, or a single tool section when '
        + 'given a verb selector.',
    description: [
        'Print the canonical CLI manual, or a single tool section when given '
            + 'a verb selector. With no arguments it prints the whole document; '
            + 'with a selector it prints just the matching tool’s section — so '
            + '`vt manual <cli-local-verb>` resolves even for verbs that never '
            + 'dispatch to a daemon RPC.',
        '',
        '**Selector forms:** the verb may be given multi-token exactly as it '
            + 'appears on the command line (`vt manual agent spawn`, '
            + '`vt manual graph create`) or single-token, joined with spaces and '
            + 'optionally `vt`-prefixed (`vt manual "vt agent spawn"`, '
            + '`vt manual "agent spawn"`). Lookup is normalized: case-folded, '
            + 'leading `vt` stripped, and `.`/`_`/`-` folded to spaces, so '
            + '`agent.spawn` and `agent spawn` resolve to the same section. The '
            + 'daemon-side RPC tool name (e.g. `spawn_agent`) is intentionally '
            + 'NOT a valid selector — the CLI surface is canonical; to discover '
            + 'the RPC parameter shape, run `vt <verb> --help` and read each '
            + 'flag’s `(RPC: <param>)` annotation.',
        '',
        '**Whole-manual triggers:** an empty argument list, or a first '
            + 'argument of `--help`, `-h`, or `help`, prints the full manual.',
        '',
        '**Not found:** an unrecognized selector errors with up to three '
            + '"did you mean" candidates (ranked by edit distance over the '
            + 'normalized verbs) followed by the full list of available verbs.',
        '',
        'This verb is CLI-local and performs no filesystem I/O: the manual is '
            + 'rendered at runtime from the in-process `MANUAL_SPECS` data '
            + '(daemon-dispatched `TOOL_SPECS` plus the CLI-local doc-only '
            + 'specs). It does NOT dispatch to a daemon RPC, so there are no '
            + '`(RPC: …)` parameter mappings.',
    ].join('\n'),
    inputs: [
        {
            cliBulletLabel: '[selector]',
            annotation: 'positional',
            description:
                'Optional CLI verb to render a single section for. May be '
                + 'multi-token (`agent spawn`), single-token quoted '
                + '(`"agent spawn"`), and optionally `vt`-prefixed; separators '
                + '`.`/`_`/`-` are folded to spaces. Omit to print the whole '
                + 'manual.',
        },
        {
            cliBulletLabel: '--help / -h',
            annotation: '',
            description:
                'As the first argument, prints the full manual (treated '
                + 'identically to passing no selector or the literal `help`).',
        },
    ],
}

const VT_HELP_SPEC: ToolSpec = {
    cliVerb: 'vt help',
    tier: 'reference',
    summary:
        'Print the top-level `vt` usage banner: commands, global flags, and '
        + 'where to go for subcommand detail.',
    description: [
        'Print the top-level `vt` usage banner: commands, global flags, and '
            + 'where to go for subcommand detail. The same banner is printed by '
            + '`vt help`, `vt --help`, `vt -h`, and by running `vt` with no '
            + 'arguments.',
        '',
        '**Lists the command families** — `agent`, `graph`, `serve`, '
            + '`search`, `project`, `session`, `view`, `debug`, `manual`, and '
            + '`help` — with a one-line gloss for each (`serve` is described as '
            + '"Start headless daemon (graph-db + vt-daemon) for a project"). '
            + 'It also documents the global flags `--terminal` / `-t` (caller '
            + 'terminal id, defaulting to `$VOICETREE_TERMINAL_ID`) and `--json` '
            + '(force JSON output), and points to `vt <command> --help` for '
            + 'per-subcommand detail.',
        '',
        'This is the human-oriented top-level overview. For the full, '
            + 'machine-generated tool reference (every verb, flag, and RPC '
            + 'mapping) use `vt manual` instead.',
        '',
        'This verb is CLI-local: it writes a static usage string to stdout '
            + 'and does NOT dispatch to a daemon RPC, so there are no '
            + '`(RPC: …)` parameter mappings.',
    ].join('\n'),
    inputs: [
        {
            cliBulletLabel: '--help / -h',
            annotation: '',
            description:
                'At the top level (`vt --help` / `vt -h`) prints this same '
                + 'usage banner. Running `vt` with no command, or the literal '
                + '`vt help`, produces identical output.',
        },
    ],
}

export const TOP_LEVEL_SPECS: readonly ToolSpec[] = [
    VT_SERVE_SPEC,
    VT_MANUAL_SPEC,
    VT_HELP_SPEC,
]
