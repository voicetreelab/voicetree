// Black-box tests for runIncrementalMutation. The unit under test is the
// orchestrator: given changed-files (from a fake git) and the real workspace
// stryker.config.json, what stryker args does it forward, and what exit code
// does it produce.
//
// We do not mock Stryker. We capture the args that *would* have been spawned
// and assert on them — exactly what CLAUDE.md asks for: assert on observable
// outputs of a function, not on internal calls.

import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

import {describe, expect, it} from 'vitest'

import {
    resolveBaseRef,
    runIncrementalMutation,
    type IncrementalMutationDeps,
} from './run-mutation-incremental.ts'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..', '..')

type SpawnCapture = {workspaceDir: string; args: readonly string[]}

function fakeDeps(
    changedFiles: readonly string[],
    strykerExit = 0,
): {deps: IncrementalMutationDeps; spawns: SpawnCapture[]; stderrChunks: string[]} {
    const spawns: SpawnCapture[] = []
    const stderrChunks: string[] = []
    const stderr: NodeJS.WritableStream = Object.assign(
        Object.create(null),
        {write(chunk: string | Uint8Array) { stderrChunks.push(chunk.toString()); return true }},
    ) as NodeJS.WritableStream
    const deps: IncrementalMutationDeps = {
        getChangedFiles: async () => changedFiles,
        spawnStryker: async (workspaceDir, args) => {
            spawns.push({workspaceDir, args})
            return strykerExit
        },
        stderr,
    }
    return {deps, spawns, stderrChunks}
}

describe('runIncrementalMutation — graph-state', () => {
    it('forwards only changed .ts source files (workspace-relative, comma-joined) via --mutate', async () => {
        const {deps, spawns} = fakeDeps([
            'packages/libraries/graph-state/src/apply/setPan.ts',
            'packages/libraries/graph-state/src/apply/setZoom.ts',
            'packages/libraries/graph-model/src/pure/graph/index.ts',  // wrong workspace, drop
            'packages/libraries/graph-state/README.md',                  // not .ts, drop
        ])
        const result = await runIncrementalMutation(
            {workspace: '@vt/graph-state', baseRef: 'origin/main', repoRoot: REPO_ROOT},
            deps,
        )
        expect(result.kind).toBe('ran-stryker')
        if (result.kind !== 'ran-stryker') throw new Error('unreachable')
        expect(result.mutatePaths).toEqual(['src/apply/setPan.ts', 'src/apply/setZoom.ts'])
        expect(result.strykerArgs).toEqual([
            'run', 'stryker.config.json', '--mutate', 'src/apply/setPan.ts,src/apply/setZoom.ts',
        ])
        expect(spawns).toHaveLength(1)
        expect(spawns[0].workspaceDir).toBe(join(REPO_ROOT, 'packages', 'libraries', 'graph-state'))
        expect(spawns[0].args).toEqual(result.strykerArgs)
    })

    it('applies stryker.config.json mutate exclusions (tests, index.ts, fixtures, rootIO)', async () => {
        const {deps, spawns} = fakeDeps([
            'packages/libraries/graph-state/src/apply/setPan.ts',
            'packages/libraries/graph-state/src/apply/setPan.test.ts',
            'packages/libraries/graph-state/src/index.ts',
            'packages/libraries/graph-state/src/fixtures/foo.ts',
            'packages/libraries/graph-state/src/fixtures.ts',
            'packages/libraries/graph-state/src/rootIO.ts',
            'packages/libraries/graph-state/src/emptyState.ts',
            'packages/libraries/graph-state/tests/integration.ts',
        ])
        const result = await runIncrementalMutation(
            {workspace: '@vt/graph-state', baseRef: 'origin/main', repoRoot: REPO_ROOT},
            deps,
        )
        expect(result.kind).toBe('ran-stryker')
        if (result.kind !== 'ran-stryker') throw new Error('unreachable')
        expect(result.mutatePaths).toEqual(['src/apply/setPan.ts'])
        expect(spawns).toHaveLength(1)
    })

    it('returns no-changes + exit 0 + skips spawn when nothing in workspace was touched', async () => {
        const {deps, spawns, stderrChunks} = fakeDeps([
            'packages/libraries/graph-model/src/pure/graph/index.ts',
            'README.md',
        ])
        const result = await runIncrementalMutation(
            {workspace: '@vt/graph-state', baseRef: 'origin/main', repoRoot: REPO_ROOT},
            deps,
        )
        expect(result.kind).toBe('no-changes')
        expect(result.exitCode).toBe(0)
        expect(spawns).toEqual([])
        expect(stderrChunks.join('')).toMatch(/no source files changed in workspace @vt\/graph-state vs origin\/main/)
    })

    it('propagates Stryker exit code (preserves break-threshold gating)', async () => {
        const {deps} = fakeDeps(
            ['packages/libraries/graph-state/src/apply/setPan.ts'],
            7,
        )
        const result = await runIncrementalMutation(
            {workspace: '@vt/graph-state', baseRef: 'origin/main', repoRoot: REPO_ROOT},
            deps,
        )
        expect(result.exitCode).toBe(7)
    })
})

describe('runIncrementalMutation — graph-model', () => {
    it("only mutates files under src/pure/ per the graph-model config's mutate include", async () => {
        const {deps, spawns} = fakeDeps([
            'packages/libraries/graph-model/src/pure/graph/nodes/folderCollapse.ts',
            'packages/libraries/graph-model/src/markdown.ts',  // outside src/pure/, drop
            'packages/libraries/graph-model/src/pure/graph/index.ts',  // excluded (index.ts)
            'packages/libraries/graph-model/src/pure/graph/nodes/folderCollapse.test.ts',  // excluded
        ])
        const result = await runIncrementalMutation(
            {workspace: '@vt/graph-model', baseRef: 'origin/main', repoRoot: REPO_ROOT},
            deps,
        )
        expect(result.kind).toBe('ran-stryker')
        if (result.kind !== 'ran-stryker') throw new Error('unreachable')
        expect(result.mutatePaths).toEqual(['src/pure/graph/nodes/folderCollapse.ts'])
        expect(spawns[0].args).toEqual([
            'run', 'stryker.config.json', '--mutate', 'src/pure/graph/nodes/folderCollapse.ts',
        ])
    })
})

describe('runIncrementalMutation — input errors', () => {
    it('throws a clear error when the workspace name does not resolve to a package directory', async () => {
        const {deps} = fakeDeps([])
        await expect(runIncrementalMutation(
            {workspace: '@vt/does-not-exist', baseRef: 'origin/main', repoRoot: REPO_ROOT},
            deps,
        )).rejects.toThrow(/workspace '@vt\/does-not-exist' not found/)
    })

    it('passes the configured baseRef through to getChangedFiles', async () => {
        let observedBaseRef = ''
        const deps: IncrementalMutationDeps = {
            getChangedFiles: async (baseRef) => { observedBaseRef = baseRef; return [] },
            spawnStryker: async () => 0,
            stderr: {write: () => true} as NodeJS.WritableStream,
        }
        await runIncrementalMutation(
            {workspace: '@vt/graph-state', baseRef: 'origin/dev-manu', repoRoot: REPO_ROOT},
            deps,
        )
        expect(observedBaseRef).toBe('origin/dev-manu')
    })
})

describe('resolveBaseRef', () => {
    it('returns MUTATION_BASE_REF when set (highest precedence)', () => {
        expect(resolveBaseRef({MUTATION_BASE_REF: 'origin/feature', GITHUB_BASE_REF: 'main'})).toBe('origin/feature')
    })

    it('falls back to origin/$GITHUB_BASE_REF in CI', () => {
        expect(resolveBaseRef({GITHUB_BASE_REF: 'dev-manu'})).toBe('origin/dev-manu')
    })

    it('falls back to origin/main outside CI with no override', () => {
        expect(resolveBaseRef({})).toBe('origin/main')
    })

    it('ignores empty-string env values', () => {
        expect(resolveBaseRef({MUTATION_BASE_REF: '', GITHUB_BASE_REF: ''})).toBe('origin/main')
    })
})
