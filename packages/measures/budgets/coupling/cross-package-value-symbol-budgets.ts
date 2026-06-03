// Budget: max distinct VALUE symbols allowed per directed pair.
// Type-only imports are free (zero runtime coupling).
// Missing pairs default to 0 — any new cross-package coupling breaks CI.
// Initial values captured 2026-05-14 after widening discovery to the whole repo
// (webapp + packages/libraries/* + packages/systems/*). Ratchet down over time.
//
// 2026-05-15 [BF-270]: DOVL+UFV epic structural baseline bump. Three pairs grew
// from new daemon project lifecycle + folder-state/view wire shapes added across
// JOINT-001 / UFV-2 / BF-245:
//   graph-db-client -> graph-db-protocol: 17 -> 25 (+8)
//   graph-db-server -> graph-state:        7 -> 10 (+3)
//   graph-db-server -> graph-db-protocol:  1 -> 4  (+3)
// 2026-05-21: Tier 2 editor-typing-order fix in writeMarkdownFile.ts needs
// getAppendedSuffix + isAppendOnly + fromNodeToContentWithWikilinks from
// graph-model to compute pending external-append preservation server-side:
//   graph-db-server -> graph-model:       38 -> 41 (+3)
// 2026-05-24: Extract @vt/observability (Pattern P2 deep-function package) so
// tracing.init / tracing.span / tracing.syncSpan are one cohesive capability
// owned by a single library, not three loose symbols re-exported from
// graph-db-client (which also had a copy-pasted twin in graph-db-server).
// Webapp now goes to observability for tracing, not graph-db-client:
//   webapp -> graph-db-client:           11 -> 9 (-2 tracing symbols removed;
//     `subscribeOwnerDiagnostics` remains — see BF-347 note below)
//   webapp -> observability:              0 -> 1 (+tracing facade)
// (graph-db-server -> observability has no row because the only consumer is
// bin/vt-graphd.ts, which lives outside the test's src-only scan scope.)
//
// 2026-05-24 BF-347 owner-diagnostic→span bridge: observability owns the
// data-shape transformation (`bridgeOwnerDiagnostics(subscribe, tracerName)`)
// but does NOT import `subscribeOwnerDiagnostics` from graph-db-client —
// that would close a `graph-db-client → graph-db-server → observability →
// graph-db-client` package cycle. The webapp shell injects the subscribe
// function, keeping observability a dependency-leaf for runtime tracing.
// Even a type-only import would make observability a 2-of-2 boundary
// package under pressure-axes, so the event shape is duplicated structurally
// inside the bridge.
//
// 2026-05-26: parallel-branch merge gap. `ec330b7fd` (extract positioning
// from authoring paths to the daemon watcher) introduced one new value
// import in graph-db-server — `resolveInitialPositionsForDelta` from
// `@vt/graph-model/spatial`, used in `applyGraphDeltaToMemState` to resolve
// initial positions for any delta whose nodes arrived with `position=O.none`
// (authoring code now uses that for agent-spawn batches). That refactor
// net-removed 42 production .ts lines by consolidating positioning into one
// pure call; the budget bump records the new symbol the consolidation
// requires rather than rolling back the refactor:
//   graph-db-server -> graph-model:       41 -> 42 (+1 resolveInitialPositionsForDelta)
//
// 2026-05-26 [BF-369]: factor @vt/daemon-lifecycle from graph-db-server +
// graph-db-client (parent-pid watchdog, owner-record I/O, decideOwnerAction
// + evidence types, spawn lock, cooldown breadcrumb, process liveness,
// health-identity probe, generic spawnDaemon, errors, diagnostics bus,
// generalised over DaemonKind). Both graph-db-server and graph-db-client
// now import the lifecycle primitives instead of carrying parallel copies:
//   daemon-lifecycle -> graph-db-protocol: 0 -> 2 (ownerRecordFile +
//     HealthResponseSchema; the only values daemon-lifecycle needs from
//     the on-disk shape; the type-only re-exports are free)
//   graph-db-client -> daemon-lifecycle: 0 -> 23 (full lifecycle surface:
//     owner record I/O, decision rule, spawn lock, cooldown breadcrumb,
//     probes, errors, diagnostics, poll-timing primitives, spawnDaemon)
//   graph-db-server -> daemon-lifecycle: 0 -> 10 (owner record atomic
//     primitives + ownerRecordFile + decode + isOwnerPidAlive +
//     startParentWatch + withBoundPort + withHeartbeat + createInitialRecord)
//   graph-db-client -> graph-db-protocol: 25 -> 24 (one fewer value: types
//     and the diagnostics event union now reach client via daemon-lifecycle)
//   graph-db-server -> graph-db-protocol: 4 -> 1 (CONTRACT_VERSION only;
//     owner record helpers route through daemon-lifecycle)
//
// 2026-05-26: record budgets for newly-extracted sibling packages whose
// edges did not exist when the manifest was last updated. None of these
// is a regression in pre-existing coupling — each is the measured value
// for an edge that began at 0 on the package-extraction commit.
//
// `@vt/vt-rpc` (`packages/libraries/vt-rpc/`, scaffolded 2026-05-24):
// shared HTTP/JSON-RPC transport primitives (port-file discovery, auth
// token read/write, rpc client). Pure-infrastructure leaf consumed by
// both daemon and clients (mirrors `@vt/observability` line above):
//   graph-tools -> vt-rpc:                 0 -> 8  (live transport client +
//     headless server use rpc client + auth/port-file helpers)
//   vt-daemon -> vt-rpc:                   0 -> 2  (ERROR_CODES,
//     redactAuthorizationHeader for HTTP server middleware)
//   vt-fake-agent -> vt-rpc:               0 -> 1  (createRpcClient)
//   webapp -> vt-rpc:                      0 -> 3  (generateAuthToken,
//     writeAuthTokenFile, writeRpcPortFile in electron daemon binding)
//
// `voicetree-cli` (`packages/systems/voicetree-cli/`, extracted from webapp
// 2026-05-23 `21622d06e`): the headless `vt` CLI. The package took over
// the headless subset of webapp's responsibilities, so its sibling-package
// imports look structurally similar to webapp's (graph-db-client + vt-daemon
// + graph-tools + agent-runtime are exactly the same orchestration surface,
// just driven from the CLI instead of the Electron shell). Each count here
// is the measured value at extraction; voicetree-cli should ratchet down
// over time, not up:
//   voicetree-cli -> agent-runtime:        0 -> 4  (vt serve spawns runtime)
//   voicetree-cli -> graph-db-client:      0 -> 7  (vt graph/project/session)
//   voicetree-cli -> graph-db-server:      0 -> 3  (search backend + types
//     for vt graph index/search)
//   voicetree-cli -> graph-model:          0 -> 1  (fromNodeToMarkdownContent
//     for vt graph snapshot)
//   voicetree-cli -> graph-tools:          0 -> 12 (graphGroup/Move/Rename
//     re-exports + view renderers + filesystem authoring helpers +
//     computeComplexityFromProject for `vt graph complexity`)
//   voicetree-cli -> voicetree-graph-validation: 0 -> 1 (OVERRIDABLE_RULE_IDS
//     for --override parser)
//   voicetree-cli -> vt-daemon:            0 -> 7  (vt serve boots the
//     in-process daemon with the same tool catalog the Electron shell uses)
//   voicetree-cli -> vt-rpc:               0 -> 9  (rpc client + auth/port
//     discovery for talking to the daemon)
//
// 2026-05-26 [BF-369/370/373]: VTD standalone-controller Phase 1 introduces
// the `vt-daemon-client` package and new vt-daemon → {graph-db-protocol,
// daemon-lifecycle} edges. None of these existed before Phase 1; each row
// records the measured value at the package-introduction commit:
//   vt-daemon-client -> daemon-lifecycle: 0 -> 10 (full owner-lifecycle
//     surface: spawn coordinator, decideOwnerAction, probes, errors,
//     diagnostics — mirrors the graph-db-client edge)
//   vt-daemon-client -> graph-db-client: 0 -> 3   (spawnCoordinator
//     orchestrator reuse via sub-path)
//   vt-daemon-client -> graph-db-protocol: 0 -> 1 (CONTRACT_VERSION)
//   vt-daemon-client -> vt-rpc: 0 -> 1            (auth/port helpers)
//   vt-daemon -> daemon-lifecycle: 0 -> 9         (BF-369 factored vtd
//     owner lifecycle into the shared library)
//   vt-daemon -> graph-db-protocol: 0 -> 2        (BF-370 uses the owner
//     contract directly for the vtd owner record)
//
// Same commit also raises the existing `daemon-lifecycle -> graph-db-protocol`
// budget from 2 to 3 (+1) — see the inline comment above that entry below.
//
// 2026-05-27 [Phase 2 / BF-376]: BF-376 outbound caller-cutover adds the
// `vt-daemon-protocol` package and the webapp→vt-daemon-client edge that
// replaces the webapp→agent-runtime edge:
//   vt-daemon -> vt-daemon-protocol:        0 -> 1  (TERMINAL_REGISTRY_EVENT_TYPES
//     for terminalRegistrySse.ts; topic-name const is type-only here)
//   vt-daemon-client -> vt-daemon-protocol: 0 -> 1  (`*` namespace re-export
//     of the contracts so client wrappers and renderers reach them through
//     one entry point; the 26 type-only symbols are free)
//
// `webapp -> vt-daemon-client`: 0 -> 13 — Phase 2 BF-376 outbound. Webapp
// is now a pure client of the per-project VTD via vt-daemon-client. The 13
// value symbols are the 11 spawn / recovery / registry-management /
// agent-events wrappers plus `ensureVtDaemonForProject` + `bindVtDaemonClient`
// for project-bind and `TERMINAL_REGISTRY_EVENT_TYPES` for the SSE topic.
//
// 2026-05-27 [Slice D]: @vt/agent-runtime retired. All terminal/spawn/runtime/
// lifecycle/headless/hooks/inject/recovery/completion code absorbed into
// @vt/vt-daemon. All previously-budgeted agent-runtime edges drop to zero
// and their budget entries are removed; default budget is 0, so re-adding
// any edge to a deleted package would hard-error.
//
// 2026-05-29 [runtime-state/unify-voicetree-home-and-project-paths]:
// Extract `@vt/paths` as the single source of truth for global VoiceTree home
// and project-local `.voicetree` path construction. This intentionally moves
// the previously scattered path constants/resolvers out of app-config,
// vt-rpc, vt-daemon, and callers into one tiny dependency leaf:
//   app-config -> paths:             0 -> 2 (settings/config/project IO)
//   daemon-lifecycle -> paths:       0 -> 1 (owner cooldown/lock files)
//   graph-db-client -> paths:        0 -> 1 (graphd port discovery)
//   graph-db-protocol -> paths:      0 -> 1 (owner record filename)
//   graph-db-server -> paths:        0 -> 2 (daemon types + port files)
//   graph-tools -> paths:            0 -> 1 (live CRUD positions path)
//   perf-fixtures -> paths:          0 -> 1 (realistic project fixture layout)
//   voicetree-bootcamp -> paths:     0 -> 1 (scenario fixture runtime files)
//   voicetree-cli -> paths:          0 -> 2 (home-path command + project marker)
//   vt-daemon -> paths:              0 -> 4 (spawn env + runtime state)
//   vt-daemon-client -> paths:       0 -> 1 (VTD owner discovery)
//   vt-rpc -> paths:                 0 -> 1 (auth/port files)
//   webapp -> paths:                 0 -> 2 (Electron build config + project bootstrap)
// 2026-06-02 [extract @vt/daemon-test-harness from voicetree-cli e2e — PR #229]:
// The harness's reason to exist is booting, validating, and tearing down REAL
// graphd + vtd daemons for the daemon round-trip e2e (no internal mocks — see
// serveHarness.ts header). It therefore legitimately imports the minimal
// real-daemon-control surface as VALUE symbols (every type-only import is
// already `import type` and uncounted):
//   - graph-db-client: 2 — `ensureGraphDaemonForProject` (prewarmGraphd, the
//     same graphd ensure `vt serve` uses) + `GraphDbClient` (shutdownGraphd /
//     ensureCleanProject, which the webapp browser-e2e globalTeardown relies on
//     to shut graphd down by owner record).
//   - vt-daemon-client: 1 — `ensureNodeVtDaemonForProject`, the vtd ensure entry
//     the harness boots the daemon-under-test with.
//   - vt-rpc: 1 — `readAuthTokenFile`, reads the per-project token the harness
//     needs to authenticate against the freshly-booted daemon.
//   - graph-db-protocol: 3 — `HealthResponseSchema` + `VtDaemonHealthResponseSchema`
//     (assert both daemons are actually healthy before a test proceeds) +
//     `ownerRecordFile` (locate the owner record for teardown).
// These symbols previously lived inside voicetree-cli's e2e harness FILE (under
// the `voicetree-cli -> graph-db-client: 7` budget); the extraction carried them
// across unchanged — a topology change (the harness moved to its own scanned
// `src/`), not new coupling. Mirrors the existing sanctioned real-daemon-booting
// leaves `voicetree-bootcamp -> graph-db-client: 1` and `vt-daemon ->
// graph-db-client: 1`. Should not grow.
//
// 2026-06-03: the create_graph child_count_limit + graph_complexity_limit gates:
//   vt-daemon -> graph-tools: 7 -> 8 (+1 computeGraphComplexity, the same
//     measure `vt graph complexity` runs, applied to the destination cluster)
//   vt-daemon -> graph-model: 24 -> 27 (+3 the gates' tunable settings defaults
//     DEFAULT_MAX_CHILDREN_PER_NODE / _COMPLEXITY_WARN_SCORE / _COMPLEXITY_BLOCK_SCORE)
export const CROSS_PACKAGE_VALUE_SYMBOL_BUDGETS: Readonly<Record<string, number>> = {
    'app-config -> graph-model': 4,
    'daemon-test-harness -> graph-db-client': 2,
    'daemon-test-harness -> vt-daemon-client': 1,
    'daemon-test-harness -> vt-rpc': 1,
    'daemon-test-harness -> graph-db-protocol': 3,
    'app-config -> paths': 3,
    // 2026-05-28 [PR #139]: @vt/code-graph-cli is a thin agent-facing wrapper
    // around `@vt/measures`' `buildCallGraph` — single value symbol
    // (`buildCallGraph`) plus a pair of type re-exports (`CallGraph`,
    // `FunctionNode`). cgcli's purpose IS this edge; expanding it would
    // mean duplicating the call-graph algorithm.
    'code-graph-cli -> measures': 1,
    // BF-369: +1 vs base — daemonKind generalisation widened the protocol
    // surface (DaemonKind type now imported alongside the existing 2 symbols).
    'daemon-lifecycle -> graph-db-protocol': 3,
    'daemon-lifecycle -> paths': 1,
    'graph-db-client -> daemon-lifecycle': 23,
    // 2026-06-02 [PR #229]: 24 -> 26. graph-db-client now owns the projectedGraph
    // SSE consumer/parser (relocated here from the webapp) plus the shared
    // DAEMON_SHUTDOWN_HEADER/_VALUE CSRF constants it sends on /shutdown — +2
    // value symbols from @vt/graph-db-protocol.
    'graph-db-client -> graph-db-protocol': 26,
    'graph-db-client -> paths': 1,
    'graph-db-protocol -> paths': 1,
    'graph-db-server -> app-config': 13,
    'graph-db-server -> daemon-lifecycle': 10,
    // 2026-06-02 [PR #229]: 1 -> 2. The server reads the shared
    // DAEMON_SHUTDOWN_HEADER constant to gate POST /shutdown against cross-origin
    // simple-POST CSRF (+1 value symbol).
    'graph-db-server -> graph-db-protocol': 2,
    'graph-db-server -> graph-model': 42,
    'graph-db-server -> graph-state': 10,
    'graph-db-server -> graph-tools': 1,
    'graph-db-server -> observability': 10,
    'graph-db-server -> paths': 2,
    'graph-state -> graph-model': 8,
    'graph-tools -> graph-model': 2,
    'graph-tools -> graph-state': 12,
    'graph-tools -> paths': 1,
    'graph-tools -> vt-rpc': 8,
    // 2026-06-03: new @vt/layout-quality package — the pure, test-only
    // layout-quality scorer, relocated out of webapp so a verification tool no
    // longer drags graph-model coupling into the app. Its geometry module reuses
    // graph-model's battle-tested `spatial` primitives (segmentsIntersect,
    // rectIntersectsSegment) instead of duplicating them — 2 value symbols. This
    // reuse IS the edge's purpose; growing it would mean re-implementing geometry.
    'layout-quality -> graph-model': 2,
    'perf-fixtures -> paths': 1,
    // 2026-05-29 [B7 bootcamp]: new @vt/voicetree-bootcamp package. Its B5
    // scenario spawns the vt-graphd daemon via graph-db-client's `ensureDaemon`
    // (one dynamic import in scenarios/b5.ts). Measured value at package
    // introduction; the bootcamp is a leaf consumer that should not grow this.
    'voicetree-bootcamp -> graph-db-client': 1,
    'voicetree-bootcamp -> paths': 1,
    'voicetree-cli -> graph-db-client': 7,
    'voicetree-cli -> graph-db-server': 3,
    'voicetree-cli -> graph-model': 1,
    'voicetree-cli -> graph-tools': 12,
    // 2026-06-02 [nested-.voicetree daemon resolution fix]: 2 -> 5. The
    // project-root up-walk (`detectProjectFromCwd`) was copy-pasted into both
    // voicetree-cli and vt-rpc with divergent precedence — that drift caused the
    // wrong-daemon bug when nested `.voicetree/` dirs exist. Consolidated into
    // @vt/paths as the single shared resolver; the CLI now imports
    // `detectProjectFromCwd` + `hasVoicetreeMarker` + `resolveProjectRoot`
    // (the last makes `$VOICETREE_PROJECT_PATH` authoritative over the CWD walk)
    // instead of carrying a local copy. A dedup, not new behaviour; ratchet down
    // if the marker check can later be folded into the composed resolver.
    'voicetree-cli -> paths': 5,
    'voicetree-cli -> voicetree-graph-validation': 1,
    'voicetree-cli -> vt-daemon': 7,
    // 2026-05-27 [Phase 3]: vt-daemon-client is the canonical ensure facade
    // for non-daemon peers (BF-377); the CLI is a peer just like webapp and
    // calls `ensureVtDaemonForProject` to spawn-or-adopt the per-project VTD.
    'voicetree-cli -> vt-daemon-client': 1,
    // 2026-05-28 [TOOL-SPEC-SSoT]: 0 -> 4. `vt manual` is a pure function of
    // the protocol's canonical spec set, so the CLI legitimately reaches in
    // for `TOOL_SPECS` (the data), plus three pure helpers that operate on
    // it: `renderManual` (full / essentials), `renderManualSection` (single
    // tool), `findSpecByCliVerb` (verb resolution). These are the minimum
    // necessary — each verb of `vt manual` calls exactly one of them.
    'voicetree-cli -> vt-daemon-protocol': 4,
    'voicetree-cli -> vt-rpc': 9,
    // 2026-05-27: collapse-paths. `resolveVoicetreeHomePath` is now
    // sourced from @vt/app-config (the canonical single-line resolver), not
    // from a CLI-local mirrored copy. The function body is 1 line — the
    // duplicate `voicetree-cli/src/commands/util/voicetreeHomePath.ts` shim
    // (with its "must stay in sync" comment) and the second copy at
    // `voicetree-cli/src/voicetreeHomePath.ts` are both deleted. Net: +1 value
    // symbol on this edge, −2 duplicate files and one human-attention
    // invariant.
    'voicetree-cli -> app-config': 1,
    // 2026-05-27: collapse-paths. `resolveVoicetreeHomePath` is again
    // imported into vt-daemon (vtd boot + spawn helpers + graph-db-server's
    // daemonTypes module). Prior duplication via the `vt-daemon/src/state/
    // voicetree-home.ts` shim is deleted (the shim's `getVoicetreeHomePath` had
    // a "must stay in sync" comment). +1 symbol, −1 duplicate file.
    'vt-daemon -> app-config': 2,
    'vt-daemon -> daemon-lifecycle': 9,
    // 2026-05-27 [Phase 3]: vt-daemon reads/writes vt-graphd via the HTTP
    // client (BF-375 standalone-vtd boundary). `GraphDbClient` is constructed
    // once during daemon bootstrap; further reach into graphd is via that handle.
    // 2026-06-02 [PR #229]: 1 -> 2. The graph.* gateway routes ("everything
    // through VTD") delegate to graph-db-client, adding one more value symbol.
    'vt-daemon -> graph-db-client': 2,
    'vt-daemon -> graph-db-protocol': 2,
    // 2026-05-27 [Phase 3]: graph-model is a leaf data package; widening
    // 9 -> 10 as the daemon takes over Main's normalization paths under
    // BF-379. New value: `createTaskNode` for daemon-side graph mutation
    // helpers; all other 9 symbols are unchanged.
    //
    // 2026-05-27 [Slice D]: 10 -> 18. Pre-absorption budget was
    // vt-daemon→graph-model 10 + agent-runtime→graph-model 13 = 23 total.
    // Post-absorption collapses to 18 (net -5). Topology change, not
    // regression — agent-runtime is deleted; its 13 graph-model imports were
    // absorbed into vt-daemon and overlap by 5 with the prior 10. The 18 are
    // the same call sites that previously crossed a sibling boundary; they
    // now cross the same (vt-daemon → graph-model) boundary instead.
    //
    // 2026-06-01 [create-graph feature]: +5. The create-graph RPC tool
    // (createGraphTool.ts, createGraphBatch.ts, createGraphTopology.ts,
    // createGraphValidation.ts) added graph-model value symbols:
    // extractParentRefs, normalizeBatchFilenameKey (markdown parsing),
    // getFolderIdentityNoteId, findBestMatchingNode, getFolderParent,
    // isFolderIdentityNote (graph queries), DEFAULT_SUBGRAPH_{WARN,ERROR}_THRESHOLD
    // (settings). Observed 23; ratchet DOWN as create-graph is refactored.
    //
    // 2026-06-02 [agent-name roster + prompt addendum]: 23 -> 24 (+1). The spawn
    // pipeline gains one graph-model entry point: the naming call site swapped
    // getNextAgentName for pickAgentName(settings) (net zero) and
    // buildTerminalEnvVars adds appendPersonaToAgentPrompt; the roster/lookup/
    // render internals stay inside graph-model so the daemon depends on one new
    // symbol, not three.
    'vt-daemon -> graph-model': 27,
    // 2026-05-27 [Phase 3]: daemon owns live-command dispatch + state
    // hydration post-BF-379. Three value symbols: `applyCommandWithDelta`,
    // `hydrateCommand`, `serializeState` (all wire shapes formerly evaluated
    // in webapp's process).
    'vt-daemon -> graph-state': 3,
    'vt-daemon -> graph-tools': 8,
    'vt-daemon -> observability': 10,
    'vt-daemon -> paths': 4,
    'vt-daemon -> voicetree-graph-validation': 1,
    // 2026-05-28 [TOOL-SPEC-SSoT]: 1 -> 4. After the single-source-of-truth
    // refactor (PR #137 + follow-up), vt-daemon-protocol owns TOOL_SPECS plus
    // the manual renderer + the [From:] wrapper. The daemon now imports four
    // distinct value symbols and only four: `TOOL_SPECS` (catalog.ts iterates
    // it to bind handlers; cliManualInjection.ts re-uses it for the spawn
    // essentials slice), `renderManual` (cliManualInjection.ts), `buildFromPrefixedMessage`
    // (sendMessageTool.ts), and one terminal-registry constant. The earlier
    // shape of "14 individual *_SPEC constants" was an over-export of
    // implementation detail; those are no longer in the protocol barrel.
    // 2026-06-02 [PR #229]: 4 -> 5. vt-daemon consumes the published graph.*
    // gateway RPC contract from vt-daemon-protocol (+1 value symbol).
    'vt-daemon -> vt-daemon-protocol': 5,
    // 2026-05-27 [Phase 3]: +1 — `VOICETREE_DIRNAME` currently lives in
    // `@vt/vt-rpc/portFile`; it should move to a leaf paths package
    // (proposed `@vt/project-paths` or `@vt/paths`). See #123 for
    // the follow-up consolidation issue. After that lands, ratchet back
    // to 2 (just `ERROR_CODES`, `redactAuthorizationHeader`).
    'vt-daemon -> vt-rpc': 3,
    'vt-daemon-client -> daemon-lifecycle': 10,
    // 2026-05-27 [03c387be2]: +1 — `resolveDaemonRuntimeCommand` added so
    // VTD spawn finds a `node:sqlite`-validated Node runtime instead of
    // the Electron binary (Electron treats the entrypoint as a renderer
    // and silently fails to open VTD's HTTP port). Symbol lives in graphd's
    // runtime helper; vt-daemon-client reuses it across the sibling-daemon
    // boundary rather than duplicating the resolver.
    'vt-daemon-client -> graph-db-client': 4,
    'vt-daemon-client -> graph-db-protocol': 1,
    'vt-daemon-client -> paths': 1,
    'vt-daemon-client -> vt-daemon-protocol': 1,
    'vt-daemon-client -> vt-rpc': 1,
    'vt-fake-agent -> vt-rpc': 1,
    // 2026-06-02 [nested-.voicetree daemon resolution fix]: 1 -> 3. vt-rpc's
    // `discoverDaemonEndpoint` carried its own copy of the project-root up-walk;
    // it now imports the shared `detectProjectFromCwd` + `hasVoicetreeMarker`
    // from @vt/paths (and makes `$VOICETREE_PROJECT_PATH` win over the CWD walk).
    // Same dedup as the voicetree-cli edge above — removes a duplicated resolver.
    'vt-rpc -> paths': 3,
    // 2026-05-27: ratcheted 24 -> 22. stripStaleVoicetreeMcpEntries +
    // writeProjectAgentDiscoveryFile were briefly here (ce909fdeb) but only
    // webapp's electron-main calls them; now live colocated in
    // webapp/src/shell/edge/main/runtime/electron/startup/project-bootstrap/.
    'webapp -> app-config': 22,
    'webapp -> graph-db-client': 9,
    'webapp -> graph-model': 86,
    'webapp -> graph-state': 19,
    'webapp -> graph-tools': 14,
    // 2026-06-01: set to 10 — observability is a dependency-leaf tracing package;
    // coupling to it is intentional and not a quality concern.
    'webapp -> observability': 10,
    // 2026-05-31 [worktree-placement-unload]: 2 -> 3 (+1 normalizeProjectPath,
    // openProject canonicalization edge — see paths header block above).
    'webapp -> paths': 3,
    // 2026-05-30 [BF-435]: 0 -> 1. The tiered perf-probe is started once at
    // electron-main boot via the single facade `perfProbeFromEnv('vt-electron-main')`
    // and stopped on `will-quit`. electron-main is the impure shell/edge — the
    // correct home for best-effort profiling startup (a probe failure only logs
    // and never blocks boot). This mirrors the `webapp -> observability: 1`
    // tracing-facade line exactly: one value symbol for one cohesive
    // observability capability owned by a leaf package. Should not grow.
    'webapp -> perf-analysis': 1,
    // 2026-05-27: ratcheted 13 -> 0. Post-BF-376 + the three coupling
    // cleanups above (drop in-process configureMcpServer +
    // registerChildIfMonitored, move FS helpers to @vt/app-config, fix
    // peekCurrentProject -> getActiveProject in getMetricsViaVtd) webapp has
    // ZERO value imports from `@vt/vt-daemon`. The remaining type-only
    // imports (AgentMetricsData / SessionMetric / TopicName / etc.) cost
    // nothing at runtime and stay free. Any future value import becomes
    // a hard CI failure — webapp is supposed to reach vt-daemon over the
    // HTTP boundary via `@vt/vt-daemon-client`, not in-process.
    'webapp -> vt-daemon': 0,
    // 2026-05-28 [PR #135 merge]: +1 — `removePersistedAgentRecord` added as the
    // RPC verb backing the webapp "Show older" UX that lets users delete
    // historical agent records (dev-manu UX preserved through the dev-manu→dev
    // integration). Single new symbol on the canonical HTTP boundary.
    'webapp -> vt-daemon-client': 14,
    // 2026-05-28 [TOOL-SPEC-SSoT]: 0 -> 1. Project-bootstrap renders the
    // canonical CLI manual into CLAUDE.md / AGENTS.md before any daemon
    // is up, so it must reach the renderer at the leaf protocol package
    // directly. The single import is `renderFullManual` (no-arg helper
    // — TOOL_SPECS stays daemon-side detail). Tests pass a literal body
    // string and don't import anything from the protocol package.
    'webapp -> vt-daemon-protocol': 1,
    'webapp -> vt-rpc': 3,
}
