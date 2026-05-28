import {defineConfig} from 'vitest/config'

// Health checks scan the whole repo (call-graph, semantic duplication,
// cross-package coupling). On ubuntu-latest's 7 GiB / 4-core runner the
// default 3 parallel forks each accumulate ~2 GiB of working set and
// trip Node 22's OOMHandler ~4 min in. Force single-fork sequential
// execution: the suite is ~3 min wall-clock either way (the heavy
// tests dominate), and single-fork keeps total memory usage well
// under the runner's physical RAM.
export default defineConfig({
    test: {
        pool: 'forks',
        poolOptions: {
            forks: {
                singleFork: true,
            },
        },
    },
})
