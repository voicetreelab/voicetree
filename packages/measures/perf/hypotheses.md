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

## Open

| # | Hypothesis | Cheapest probe |
|---|---|---|
| 9 | The remaining ~200ms p50 is kernel-side file-creation cost (dentry/inode alloc + journal entry for `O_CREAT`) | Split `fs.writeFile` into `open + write + close` spans; or `strace -c -T` on the daemon under storm |
| 10 | Per-directory metadata contention — concurrent writers into the same parent dir serialize | Spread writes across N temp dirs and re-measure |
| 11 | Some shared in-process lock in the daemon's apply-delta path (not yet identified) | Synthetic test: 15 concurrent `fs.writeFile`s into the same dir from a non-VT script; if it shows the same degradation, daemon code is exonerated |
| 12 | Renderer-side CPU cost under the same storm (the actual user-felt regression) | Build the e2e Electron variant per `openspec/changes/e2e-storm-perf-test/` |

## Format

Each entry is one row. Add to the **Tested** table when an experiment lands
a verdict. Add to **Open** when a new hypothesis is worth recording but
not yet probed. Keep it terse — full drill-downs belong in progress nodes
under `get_dev_healthy/voicetree-15-5/`.
