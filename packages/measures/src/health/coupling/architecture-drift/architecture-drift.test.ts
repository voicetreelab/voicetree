import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join, relative, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'
import {runGitWorktreeCommand} from '../../../_shared/discovery/run-git'
import {recordHealthMetric} from '../../../_shared/writers/report-writer'
import {discoverArchitectureFiles, validateArchitectureDrift} from './validate-architecture-drift'

const THIS_FILE = fileURLToPath(import.meta.url)
const REPO_ROOT = resolve(THIS_FILE, '..', '..', '..', '..', '..', '..', '..')

function fixtureRoot(name: string): string {
    return resolve(THIS_FILE, '..', '..', '__tests__', 'architecture-drift', name)
}

describe('architecture drift parser', () => {
    it('accepts a root and descendant fixture when diagrams and click targets align', async () => {
        await expect(validateArchitectureDrift(fixtureRoot('valid'))).resolves.toEqual([])
    })

    it('names the node and missing click target when a target is renamed', async () => {
        const failures = await validateArchitectureDrift(fixtureRoot('missing-click-target'))
        expect(failures).toContain(
            `Node 'graphd' in architecture.md points at missing click target 'packages/systems/graph-db-server/src/missing.ts'. Reconcile by restoring the file/directory or updating the diagram.`,
        )
    })

    it('names both endpoints when an edge has no channel label', async () => {
        const failures = await validateArchitectureDrift(fixtureRoot('unlabeled-edge'))
        expect(failures).toContain(
            `Edge 'renderer --> graphd' in architecture.md has no channel label. Reconcile the diagram by adding a non-empty |channel| label.`,
        )
    })

    it('names the child file and unresolved parent id when refines points nowhere', async () => {
        const failures = await validateArchitectureDrift(fixtureRoot('bad-refines'))
        expect(failures).toContain(
            `Descendant file packages/systems/graph-db-server/architecture.md declares refines: missingParent, but that node does not exist in nearest ancestor architecture.md. Reconcile the child frontmatter or parent diagram node id.`,
        )
    })

    it('names the child click target and parent subtree when a refinement escapes', async () => {
        const failures = await validateArchitectureDrift(fixtureRoot('subtree-escape'))
        expect(failures).toContain(
            `Descendant file packages/systems/graph-db-server/architecture.md node 'outside' click target 'packages/systems/agent-runtime/src/outside.ts' escapes parent subtree 'packages/systems/graph-db-server'. Reconcile the child diagram or the parent node click target.`,
        )
    })

    it('names source imports that create undeclared architecture edges', async () => {
        const failures = await validateArchitectureDrift(fixtureRoot('source-edge-drift'))
        expect(failures).toContain(
            `Source file 'webapp/src/shell/UI/App.tsx' imports 'packages/systems/graph-db-server/bin/vt-graphd.ts', creating source edge 'renderer --> graphd' that is not declared in architecture.md. Reconcile by removing the source dependency or adding a labeled architecture edge if the dependency is intentional.`,
        )
    })
})

describe('architecture discovery', () => {
    it('never descends into gitignored runtime data that may churn or vanish mid-scan', async () => {
        // Mirrors the real failure: infra/perf-stack/storage/ is gitignored Grafana-Tempo
        // WAL data whose nested dirs are created and deleted at runtime. Discovery must
        // exclude such trees entirely — not by catching errors, but by never scanning them.
        const sandbox = await mkdtemp(join(tmpdir(), 'arch-drift-discovery-'))
        try {
            await writeFile(join(sandbox, 'architecture.md'), '```mermaid\nflowchart TD\n  a[a]\n  a --> a\n```\n')
            await writeFile(join(sandbox, '.gitignore'), 'storage/\n')

            const churningRuntimeDir = join(sandbox, 'storage', 'tempo', 'wal', 'blocks', 'deadbeef-uuid')
            await mkdir(churningRuntimeDir, {recursive: true})
            await writeFile(join(sandbox, 'storage', 'architecture.md'), '```mermaid\nflowchart TD\n  x[x]\n```\n')

            // Use the GIT_DIR-immune runner for setup too: a pre-push hook leaks
            // GIT_DIR/GIT_WORK_TREE into the env, which would otherwise make these
            // commands operate on the real repo instead of the sandbox — leaving
            // sandbox/.git uncreated and the discovery below failing with
            // "fatal: not a git repository".
            runGitWorktreeCommand(['init', '-q'], sandbox)
            runGitWorktreeCommand(['add', 'architecture.md', '.gitignore'], sandbox)

            const discovered = (await discoverArchitectureFiles(sandbox))
                .map(file => relative(sandbox, file.absPath))

            expect(discovered).toEqual(['architecture.md'])
        } finally {
            await rm(sandbox, {recursive: true, force: true})
        }
    })
})

describe('architecture drift', () => {
    it('keeps architecture.md structurally aligned with the codebase', async () => {
        const failures = await validateArchitectureDrift(REPO_ROOT)

        await recordHealthMetric({
            metricId: 'architecture-drift',
            metricName: 'Architecture Drift',
            description: 'Structural consistency between architecture.md Mermaid diagrams and repo paths.',
            category: 'Coupling',
            current: failures.length,
            budget: 0,
            comparison: 'lte',
            unit: 'violations',
            details: {failures},
        })

        expect(
            failures,
            failures.length === 0
                ? 'architecture.md matches structural architecture assertions.'
                : `Architecture drift failures:\n${failures.map(failure => `  ${failure}`).join('\n')}`,
        ).toEqual([])
    })
})
