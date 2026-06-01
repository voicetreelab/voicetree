import {defineConfig} from 'vitest/config'

// Health checks scan the whole repo (call-graph, semantic duplication,
// cross-package coupling). Cross-file parallelism is provided by
// run-systems-health.ts, which shards the suite across one isolated
// `vitest run <file>` process per file. Each invocation therefore runs a
// single file, so we keep singleFork (no extra worker fork to spawn for one
// file) — the parallelism lives in the runner, not vitest's pool.
//
// testTimeout is raised from vitest's 5s default because these tests parse
// the whole repo and can exceed 5s under the CPU contention of parallel
// shards (mirrors the root vitest.config.ts rationale). Without this the
// borderline-5s scans (e.g. cognitive-complexity) flake under load.
export default defineConfig({
    test: {
        pool: 'forks',
        poolOptions: {
            forks: {
                singleFork: true,
            },
        },
        testTimeout: 30_000,
    },
})
