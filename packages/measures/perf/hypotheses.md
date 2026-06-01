# agent-storm: hypotheses

Config: 15 agents × 30 nodes × 300-seed project on Onidel. Spans in `~/.voicetree/traces/vt-graphd.ndjson`.

| # | Hypothesis | Status | Evidence |
|---|---|---|---|
| 1 | Onidel disk slow | ❌ | single-agent writeFile p50 = 0.4ms |
| 2 | `GraphStateSchema.parse` slow | ❌ | compose-response p50 = 0.2ms |
| 3 | Link resolution under storm | ❌ | resolve-links span never fired |
| 4 | Undo/publish/read-graph/rebase | ❌ | <0.1ms each |
| 5 | libuv pool too small | ❌ | `UV_THREADPOOL_SIZE=32` made it worse |
| 6 | ext4-specific | ❌ | APFS degrades 235x too |
| 7 | chokidar feedback | ❌ | disabling moved writeFile only ~10% |
| 8 | mkdir-every-write | ✅ `56345ab8` | mkdir p50 104.9 → 0.02ms, apply-delta **-39%** |
| 9 | open vs write vs close | ➤ reframed `db642789` | each "syscall" span is event-loop-wait time, not syscall time (vs H11) |
| 10 | per-dir contention | ❌ `ce23ef31` | `--isolate-dirs` made p50 12% worse |
| 11 | fs.writeFile kernel-side | ❌ `a0c94ce2` | synthetic 15-worker storm = 3x; daemon = 250-500x → daemon code is the cause |
| 12 | Renderer CPU under storm | 🚧 partial | scaffolding in `openspec/changes/e2e-storm-perf-test/`; spec landed `35d60175` |
| **13** | **Event-loop starvation in daemon** | **✅ confirmed** `run bb3e49be` | vt-graphd `nodejs.eventloop.delay` **p99=957ms** (p50=20ms) during 50×8 storm. Plain non-fsync `fs.writeFile` of a *single small node* measured p50=88ms/p99=376ms — that is await latency behind the starved loop, not fs I/O. |
| 14 | Sync CPU-bound work in hot path | ✅ confirmed `run bb3e49be` | Synchronous `stringifyGraphForSSE(whole projected graph)` per delta (`sessionEvents.ts:76`) + `project-delta` run on the graphd loop thread; `graph.apply-delta-and-publish` wall p99=393ms. This is the CPU that drives the 957ms loop delay. |
| 15 | SetGraph/ReadGraph deep op on growing graph | ✅ confirmed `run bb3e49be` | `graphd.http GET /project` self-sum 9.15s, p99=124ms — scales with graph size; per-delta whole-graph projection+stringify is O(n)/delta → O(n²) across the 400-node run (the >300-node regime where the user reports degradation). |

## Run 2026-05-30 — 50×8 e2e-storm under LGTM (`run bb3e49be-3588-4b01-a81f-8545d7bc7fd3`)

Config: 50 agents × 8 nodes = 400 nodes, headful Electron on the Linux devbox under xvfb, OTLP→otelcol→Tempo/VM/Pyroscope (`VOICETREE_OTLP_ENDPOINT=http://localhost:2994`). 400/400 nodes landed. Spans mirrored at `~/.voicetree/perf/<run>/traces/vt-test.spans.ndjson` (3772 spans).

Ranked worst offenders (vt-graphd unless noted) — span → source → self-time:

| rank | span (offender) | source | count | self-sum | self p50 / p99 | hypothesis |
|---|---|---|---|---|---|---|
| 1 | `daemon.apply-delta.db-write.writeFile` | `graph-db-server/.../graphActionsToDBEffects.ts:185` (plain `fs.writeFile`) | 509 | **61.6s** | 88ms / 376ms | #13 (symptom: await latency behind starved loop, not fs cost) |
| 2 | `graphd.http GET /project` | graph-db-server `/project` route | 258 | 9.15s | 29ms / 124ms | #15 (scales with graph) |
| 3 | `graph.create-context-node` | graph-db-server create-context-node | 51 | 2.82s | 62ms / 104ms | #14/#15 |
| 4 | `session.events.write-projected-graph-sse` + `project-delta` + `stringify-projected-graph` | `application/workflows/sessionEvents.ts:75-89,119` | 108 ea | 0.77s combined | up to 79ms | #14 (whole-graph reproject+stringify per delta) |
| — | `nodejs.eventloop.delay` (graphd) | metric | — | — | **p99=957ms** | #13 (prime, root cause) |

Root cause: the graphd's single event-loop thread runs a synchronous O(n) whole-graph projection + SSE stringify on every delta. Past ~300 nodes this blocks the loop for ~0.5–1s at a time, which both directly slows apply-delta-and-publish (p99 393ms) and inflates every threadpool `fs.writeFile` completion to 88–376ms. Fix direction: make projection/serialization incremental (avoid re-stringifying the whole graph per delta) and/or move it off the hot loop.
