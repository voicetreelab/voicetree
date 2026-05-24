# agent-storm: hypotheses tested

Storm config: 15 agents × 30 nodes × 300-node seeded vault. Compared against
single-agent baseline (1 × 30) to isolate concurrency effects from raw
per-call cost. All measurements via OTel NDJSON spans in
`~/.voicetree/traces/vt-graphd.ndjson`.

## Tested

| # | Hypothesis | Verdict | Evidence |
|---|---|---|---|
| 1 | Onidel VM disk has high baseline latency | ❌ | single-agent writeFile p50 = 0.4ms, healthy SSD-class |
| 2 | `GraphStateSchema.parse` slows as graph grows | ❌ | compose-response p50 = 0.2ms across 450 calls |
| 3 | Link resolution does disk reads under storm | ❌ | `resolve-links` span never fired (seeded vault has no unresolved links) |
| 4 | Undo / publish / read-graph / rebase any slow | ❌ | each <0.1ms p50 |
| 5 | libuv thread pool too small (default 4) | ❌ | `UV_THREADPOOL_SIZE=32` made it **worse** (writeFile p50 100→165ms) |
| 6 | ext4-specific journal barrier on Onidel | ❌ | macOS APFS degrades 235x under same storm — universal, not Linux |
| 7 | chokidar watcher feedback loop on the write dir | ❌ | disabling chokidar moved writeFile only ~10% |
| 8 | `fs.mkdir(recursive:true)` every write is hot | ✅ | 22-32% of db-write; cached via module-scoped `Set<string>` in commit `56345ab8`; mkdir p50 went 104.9ms → 0.02ms, apply-delta -39% |
| 10 | Per-directory metadata contention — concurrent writers into the same parent dir serialize | ❌ | Tested via synthetic (commit `a0c94ce2`, `--isolate-dirs` mode): isolated dirs were *slightly slower* than shared (0.76ms vs 0.65ms p50). Per-parent dentry contention disconfirmed. |
| 11 | The remaining ~200ms is fs.writeFile under concurrent file-creation (kernel-side) | ❌ | Tested via synthetic Node script (commit `a0c94ce2`): 15-worker in-process concurrent `fs.writeFile` storm on Onidel shows only **3x** degradation (0.22ms → 0.65ms), vs VT daemon's **250-500x** (0.4ms → 100-200ms) on the same host, same Node, same FS. The fs.writeFile syscall is NOT the bottleneck. The bottleneck is in VT daemon code that runs around each write. |

## Open

| # | Hypothesis | Cheapest probe |
|---|---|---|
| 9 | Of `open` / `write` / `close`, which syscall in writeFile actually dominates the daemon's 100-200ms span | Split into 3 spans (in flight — agent `ad293311f6163927a`) |
| 12 | Renderer-side CPU cost under the same storm (the actual user-felt regression) | Build the e2e Electron variant per `openspec/changes/e2e-storm-perf-test/` (in flight — agent `a8d55e5e9da90b4b3`) |
| 13 | **Event-loop starvation in the daemon process** — 15 concurrent in-flight requests interleave with chokidar event handlers, SSE broadcasts, HTTP parsing, JSON serialization, undo recording. Each `await fs.writeFile`'s libuv resolution is delayed not by the syscall but by the JS callback queue. | `perf_hooks.monitorEventLoopDelay` histogram around the storm; or `setImmediate` round-trip timer. Should show 50ms+ event-loop lag under storm. |
| 14 | Some synchronous CPU-bound work in the daemon's hot path (full-graph JSON serialize, deep zod parse during HTTP response, deep clone during SetGraph) starves the loop | Add CPU-time span vs wall-time span side-by-side around the request handler; or v8 profiler under storm. |
| 15 | Synchronous chokidar event handlers fire during the storm even with `markPendingWrite` suppression and steal the loop | Re-measure with chokidar fully disabled (already ~10% with the kept-but-suppressed watcher; the residual handler dispatch may still cost more under load). |
| 16 | The daemon's `SetGraph` clone or `executeCommand` dispatch involves a synchronous deep operation over a growing graph | Add CPU-time spans inside `SetGraph` and `ReadGraph`; correlate with graph size. |

## Format

Each entry is one row. Add to the **Tested** table when an experiment lands
a verdict. Add to **Open** when a new hypothesis is worth recording but
not yet probed. Keep it terse — full drill-downs belong in progress nodes
under `get_dev_healthy/voicetree-15-5/`.
