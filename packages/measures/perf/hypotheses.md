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
| **13** | **Event-loop starvation in daemon** | **open (prime)** | probe: `perf_hooks.monitorEventLoopDelay` during storm |
| 14 | Sync CPU-bound work in hot path | open | probe: CPU-time vs wall-time spans, or v8 profiler |
| 15 | SetGraph/ReadGraph deep op on growing graph | open | probe: CPU-time spans inside, correlate with graph size |
