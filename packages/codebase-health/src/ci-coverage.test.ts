// Drift detector: every check file under scripts/measures/src/ must be invoked
// by at least one GitHub Actions workflow, either directly (--only=<id>) or via
// a --folder=<prefix> that contains it. Fails loudly when a new measure file is
// dropped in but no workflow runs it.
//
// Workflows reach capture-ci-checks.mjs both directly (`npm run health:capture-ci`)
// and via package.json indirection (`npm run health` → `npm run health:run` →
// `scripts/capture-ci-checks.mjs --folder=health --quick`). The resolver follows
// `npm run <name>` chains until every script that ultimately invokes the runner
// has its effective flags recorded.

import {readdir, readFile} from 'node:fs/promises'
import {dirname, join, relative, resolve, sep} from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {describe, expect, it} from 'vitest'

const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(TEST_DIR, '..', '..', '..')
const MEASURES_DIR = join(REPO_ROOT, 'scripts', 'measures', 'src')
const WORKFLOWS_DIR = join(REPO_ROOT, '.github', 'workflows')

type Measure = {
    id: string
    relPath: string
    folderChain: readonly string[]
    slow: boolean
}

type CaptureFlags = {
    folder: string | null
    quick: boolean
    only: ReadonlySet<string> | null
}

type CaptureCall = CaptureFlags & {workflow: string}

const EXPECTED_UNCOVERED_MEASURE_PATHS: readonly string[] = [
    'correctness/e2e/e2e-tier1.ts',
    'correctness/e2e/e2e-tier2-browser.ts',
    'correctness/e2e/e2e-tier2-electron.ts',
    'correctness/lint/blackbox-tests-lint.ts',
    'correctness/lint/root-lint.ts',
    'correctness/lint/verify-cytoscape-rules.ts',
    'correctness/lint/webapp-check.ts',
    'correctness/lint/webapp-lint.ts',
    'correctness/slow/fuzz/fuzz-editor-sync.ts',
    'correctness/slow/fuzz/fuzz-graph-delta.ts',
    'correctness/slow/fuzz/fuzz-graph-state-invariants.ts',
    'correctness/slow/fuzz/fuzz-session-state.ts',
    'correctness/slow/fuzz/fuzz-system-lifecycle.ts',
    'correctness/unit/agent-runtime-unit.ts',
    'correctness/unit/graph-db-server-unit.ts',
    'correctness/unit/graph-model-unit.ts',
    'correctness/unit/graph-state-unit.ts',
    'correctness/unit/graph-tools-unit.ts',
    'correctness/unit/voicetree-mcp-unit.ts',
    'correctness/unit/webapp-unit.ts',
]

async function discoverMeasureFiles(dir: string): Promise<readonly string[]> {
    const entries = await readdir(dir, {withFileTypes: true})
    const nested = await Promise.all(entries.map(async entry => {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) return discoverMeasureFiles(path)
        if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.startsWith('_')) return []
        return [path]
    }))
    return nested.flat()
}

function toFolderChain(relPath: string): readonly string[] {
    const parts = relPath.split('/')
    parts.pop()
    const chain: string[] = []
    for (let i = 1; i <= parts.length; i++) {
        chain.push(parts.slice(0, i).join('/'))
    }
    return chain
}

async function loadMeasures(): Promise<readonly Measure[]> {
    const files = await discoverMeasureFiles(MEASURES_DIR)
    const measures: Measure[] = []
    for (const file of files) {
        const rel = relative(MEASURES_DIR, file).split(sep).join('/')
        const mod = await import(pathToFileURL(file).href)
        if (!mod.check) throw new Error(`measure file ${rel} must export \`check\``)
        measures.push({
            id: mod.check.id,
            relPath: rel,
            folderChain: toFolderChain(rel),
            slow: mod.check.slow === true,
        })
    }
    return measures.sort((a, b) => a.relPath.localeCompare(b.relPath))
}

function parseCaptureFlags(rest: string): CaptureFlags {
    const folder = rest.match(/--folder=([^\s'"]+)/)?.[1] ?? null
    const onlyRaw = rest.match(/--only=([^\s'"]+)/)?.[1]
    const quick = /(?:^|\s)--quick(?:\s|$)/.test(rest)
    return {
        folder,
        quick,
        only: onlyRaw ? new Set(onlyRaw.split(',').filter(Boolean)) : null,
    }
}

async function loadCaptureScripts(): Promise<ReadonlyMap<string, CaptureFlags>> {
    const pkg = JSON.parse(await readFile(join(REPO_ROOT, 'package.json'), 'utf8')) as {
        scripts?: Record<string, string>
    }
    const scripts = pkg.scripts ?? {}
    const result = new Map<string, CaptureFlags>()

    for (const [name, body] of Object.entries(scripts)) {
        if (body.includes('capture-ci-checks.mjs')) {
            result.set(name, parseCaptureFlags(body))
        }
    }

    // Follow `npm run <name>` indirection until convergence. Some scripts wrap
    // their target in `record-run.mjs --name="npm run X" -- npm run X:run`, so we
    // walk every `npm run` reference in the body (not just the first) and skip
    // self-references before checking the already-resolved set.
    for (let pass = 0; pass < 5; pass++) {
        let added = false
        for (const [name, body] of Object.entries(scripts)) {
            if (result.has(name)) continue
            for (const m of body.matchAll(/npm run ([a-z0-9:_-]+)/gi)) {
                const target = m[1]
                if (target === name) continue
                const resolved = result.get(target)
                if (resolved) {
                    result.set(name, resolved)
                    added = true
                    break
                }
            }
        }
        if (!added) break
    }

    return result
}

function findCaptureInvocations(
    workflowText: string,
    scripts: ReadonlyMap<string, CaptureFlags>,
    workflow: string,
): readonly CaptureCall[] {
    const calls: CaptureCall[] = []
    const directRe = /npm run health:capture-ci(?:\s+--\s+([^\n]*))?/g
    for (const m of workflowText.matchAll(directRe)) {
        calls.push({workflow, ...parseCaptureFlags(m[1] ?? '')})
    }
    const indirectRe = /npm run ([a-z0-9:_-]+)/gi
    for (const m of workflowText.matchAll(indirectRe)) {
        const name = m[1]
        if (name === 'health:capture-ci') continue
        const resolved = scripts.get(name)
        if (resolved) calls.push({workflow, ...resolved})
    }
    return calls
}

function callCoversMeasure(call: CaptureCall, m: Measure): boolean {
    if (call.only) return call.only.has(m.id)
    if (call.quick && m.slow) return false
    if (call.folder === null) return true
    return m.folderChain.includes(call.folder)
}

async function loadAllCalls(scripts: ReadonlyMap<string, CaptureFlags>): Promise<readonly CaptureCall[]> {
    const workflowFiles = await readdir(WORKFLOWS_DIR)
    const calls: CaptureCall[] = []
    for (const wf of workflowFiles) {
        if (!wf.endsWith('.yml') && !wf.endsWith('.yaml')) continue
        const text = await readFile(join(WORKFLOWS_DIR, wf), 'utf8')
        calls.push(...findCaptureInvocations(text, scripts, wf))
    }
    return calls
}

function formatCall(c: CaptureCall): string {
    const folder = c.folder ?? '(all)'
    const only = c.only ? `, only=${[...c.only].sort().join(',')}` : ''
    const quick = c.quick ? ', quick' : ''
    return `${c.workflow}: --folder=${folder}${quick}${only}`
}

describe('CI coverage of scripts/measures/', () => {
    it('matches the known uncovered correctness-measure list', async () => {
        const [measures, scripts] = await Promise.all([loadMeasures(), loadCaptureScripts()])
        const allCalls = await loadAllCalls(scripts)
        const uncovered = measures.filter(m => !allCalls.some(c => callCoversMeasure(c, m)))
        const callLines = allCalls.length === 0
            ? ['  (none - no workflow invokes capture-ci-checks.mjs directly or via an npm script that does)']
            : [...new Set(allCalls.map(formatCall))].sort().map(s => `  - ${s}`)
        const measureLines = uncovered.map(m => `  - ${m.relPath}  (id=${m.id}${m.slow ? ', slow' : ''})`)

        expect(
            uncovered.map(m => m.relPath),
            `${uncovered.length}/${measures.length} measure files are not invoked by any GitHub Actions workflow.\n\n` +
            `Uncovered measures:\n${measureLines.join('\n')}\n\n` +
            `capture-ci-checks invocations detected in .github/workflows/:\n${callLines.join('\n')}`,
        ).toEqual(EXPECTED_UNCOVERED_MEASURE_PATHS)
    })
})
