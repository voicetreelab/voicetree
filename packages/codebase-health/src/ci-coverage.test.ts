// Drift detector: every check file under packages/measures/src/ must be invoked
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
const MEASURES_DIR = join(REPO_ROOT, 'packages', 'measures', 'src')
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

type WorkflowJob = {
    id: string
    text: string
}

function findWorkflowJobs(workflowText: string): readonly WorkflowJob[] {
    const jobsMatch = /^jobs:\s*$/m.exec(workflowText)
    if (!jobsMatch) return []

    const jobsText = workflowText.slice(jobsMatch.index + jobsMatch[0].length)
    const starts = [...jobsText.matchAll(/^  ([a-z0-9_-]+):\s*$/gim)]
        .map(m => ({id: m[1], start: m.index ?? 0}))

    return starts.map((job, index) => ({
        id: job.id,
        text: jobsText.slice(job.start, starts[index + 1]?.start),
    }))
}

function findOutputKeys(jobText: string): readonly string[] {
    return [...jobText.matchAll(/^\s{6}([a-z0-9_-]+):\s*\$\{\{\s*steps\.[a-z0-9_-]+\.outputs\.[a-z0-9_-]+\s*\}\}\s*$/gim)]
        .map(m => m[1])
}

function findFilesystemMeasureFolders(jobText: string): readonly string[] {
    const folders = new Set<string>()
    for (const m of jobText.matchAll(/\bls\s+packages\/measures\/src\/([^\s'"]+)\/\*\.ts\b/g)) {
        folders.add(m[1])
    }
    for (const m of jobText.matchAll(/\bfind\s+packages\/measures\/src\/([^\s'"]+)\s+[^\n|]*-name\s+['"]\*\.ts['"]/g)) {
        folders.add(m[1])
    }
    return [...folders].sort()
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function jobRunsMatrixMeasure(jobText: string, matrixVar: string): boolean {
    const matrixOnlyRe = new RegExp(
        `npm run health:capture-ci[^\\n]*--only=\\$\\{\\{\\s*matrix\\.${escapeRegExp(matrixVar)}\\s*\\}\\}`,
    )
    return matrixOnlyRe.test(jobText)
}

function findMatrixFilesystemCoverage(workflowText: string, workflow: string): readonly CaptureCall[] {
    const jobs = findWorkflowJobs(workflowText)
    const foldersByOutput = new Map<string, readonly string[]>()

    // Keep this narrow rather than adding a YAML dependency: recognize the
    // discover-job/output/matrix shape used by CI, then treat the discovered
    // filesystem folder exactly like a --folder=<prefix> capture-ci call.
    for (const job of jobs) {
        const folders = findFilesystemMeasureFolders(job.text)
        if (folders.length === 0) continue
        for (const outputKey of findOutputKeys(job.text)) {
            foldersByOutput.set(`${job.id}.${outputKey}`, folders)
        }
    }

    const calls: CaptureCall[] = []
    for (const job of jobs) {
        const matrixRe = /^\s{8}([a-z0-9_-]+):\s*\$\{\{\s*fromJSON\(needs\.([a-z0-9_-]+)\.outputs\.([a-z0-9_-]+)\)\s*\}\}\s*$/gim
        for (const m of job.text.matchAll(matrixRe)) {
            const [matrixVar, sourceJob, outputKey] = [m[1], m[2], m[3]]
            const folders = foldersByOutput.get(`${sourceJob}.${outputKey}`) ?? []
            if (folders.length === 0 || !jobRunsMatrixMeasure(job.text, matrixVar)) continue
            for (const folder of folders) {
                calls.push({workflow, folder, quick: false, only: null})
            }
        }
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
        calls.push(...findMatrixFilesystemCoverage(text, wf))
    }
    return calls
}

function formatCall(c: CaptureCall): string {
    const folder = c.folder ?? '(all)'
    const only = c.only ? `, only=${[...c.only].sort().join(',')}` : ''
    const quick = c.quick ? ', quick' : ''
    return `${c.workflow}: --folder=${folder}${quick}${only}`
}

describe('CI coverage of packages/measures/', () => {
    it('every measure file is invoked by at least one GitHub Actions workflow', async () => {
        const [measures, scripts] = await Promise.all([loadMeasures(), loadCaptureScripts()])
        const allCalls = await loadAllCalls(scripts)
        const uncovered = measures.filter(m => !allCalls.some(c => callCoversMeasure(c, m)))

        if (uncovered.length > 0) {
            const measureLines = uncovered.map(m => `  - ${m.relPath}  (id=${m.id}${m.slow ? ', slow' : ''})`)
            const callLines = allCalls.length === 0
                ? ['  (none — no workflow invokes capture-ci-checks.mjs directly or via an npm script that does)']
                : [...new Set(allCalls.map(formatCall))].sort().map(s => `  - ${s}`)
            throw new Error(
                `${uncovered.length}/${measures.length} measure files are not invoked by any GitHub Actions workflow.\n\n` +
                `Uncovered measures:\n${measureLines.join('\n')}\n\n` +
                `capture-ci-checks invocations detected in .github/workflows/:\n${callLines.join('\n')}\n\n` +
                `Fix: add a workflow step that invokes capture-ci-checks (directly via \`npm run health:capture-ci -- --folder=<prefix>\` ` +
                `or indirectly via an npm script that resolves to it) covering each measure.`,
            )
        }
        expect(uncovered).toHaveLength(0)
    })
})
