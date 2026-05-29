// Drift detector: every scheduled check under packages/measures/src/checks/
// must be invoked by at least one GitHub Actions workflow, either directly
// (--only=<id>) or through a tier/full capture-ci-checks run.

import {readdir, readFile} from 'node:fs/promises'
import {dirname, join, relative, resolve, sep} from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {describe, expect, it} from 'vitest'

const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(TEST_DIR, '..', '..', '..', '..', '..')
const CHECKS_DIR = join(REPO_ROOT, 'packages', 'measures', 'src', 'checks')
const WORKFLOWS_DIR = join(REPO_ROOT, '.github', 'workflows')
// MAX_TIER is duplicated in _runners/capture-ci-checks.ts. If you bump
// this, bump that too. The test enforces alignment: any `--tier<=N`
// invocation in .github/workflows/ with N > MAX_TIER throws here.
const MAX_TIER = 4

type ScheduledCheck = {
    id: string
    relPath: string
    tier: number
}

type CaptureFlags = {
    tierMax: number | null
    only: ReadonlySet<string> | null
}

type CaptureCall = CaptureFlags & {workflow: string}

async function discoverCheckFiles(dir: string): Promise<readonly string[]> {
    const entries = await readdir(dir, {withFileTypes: true})
    const nested = await Promise.all(entries.map(async entry => {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) return entry.name.startsWith('_') ? [] : discoverCheckFiles(path)
        if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) return []
        if (entry.name.startsWith('_')) return []
        return [path]
    }))
    return nested.flat()
}

// Mirrors _runners/capture-ci-checks.ts: only `tier_N/` and `tier_N_pre_commit/`
// are scheduled. Non-scheduled siblings like `tier_N_post_edit/` (agent-hook
// runtime, not capture-ci) are excluded so they aren't imported expecting a
// `check` export.
const SCHEDULED_TIER_SUFFIXES = ['', '_pre_commit'] as const

async function discoverScheduledCheckFiles(): Promise<readonly string[]> {
    const tierDirs = Array.from({length: MAX_TIER + 1}, (_, tier) => tier)
        .flatMap(tier => SCHEDULED_TIER_SUFFIXES.map(suffix => join(CHECKS_DIR, `tier_${tier}${suffix}`)))
    const lists = await Promise.all(tierDirs.map(async dir => {
        try {
            return await discoverCheckFiles(dir)
        } catch (err) {
            if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return []
            throw err
        }
    }))
    return lists.flat()
}

function tierFor(relPath: string): number {
    const match = /^tier_(\d+)(?:_pre_commit)?\//.exec(relPath)
    if (!match) throw new Error(`scheduled check must live under checks/tier_N(_pre_commit)?/: ${relPath}`)
    const tier = Number(match[1])
    if (!Number.isInteger(tier) || tier < 0 || tier > MAX_TIER) {
        throw new Error(`scheduled check tier must be 0 through ${MAX_TIER}: ${relPath}`)
    }
    return tier
}

async function loadScheduledChecks(): Promise<readonly ScheduledCheck[]> {
    const files = await discoverScheduledCheckFiles()
    const checks: ScheduledCheck[] = []
    for (const file of files) {
        const relPath = relative(CHECKS_DIR, file).split(sep).join('/')
        const mod = await import(pathToFileURL(file).href)
        if (!mod.check) throw new Error(`scheduled check file ${relPath} must export \`check\``)
        checks.push({id: mod.check.id, relPath, tier: tierFor(relPath)})
    }
    return checks.sort((a, b) => a.relPath.localeCompare(b.relPath))
}

function parseTierMax(rest: string): number | null {
    const match = /(?:^|\s)['"]?--(?:tier<=|tier-max=|max-tier=)(\d+)['"]?(?=\s|$)/.exec(rest)
    if (!match) return null
    const tier = Number(match[1])
    if (!Number.isInteger(tier) || tier < 0 || tier > MAX_TIER) {
        throw new Error(`capture-ci-checks tier must be 0 through ${MAX_TIER}: ${match[0].trim()}`)
    }
    return tier
}

function parseCaptureFlags(rest: string): CaptureFlags {
    const onlyRaw = rest.match(/--only=([^\s'"]+)/)?.[1]
    return {
        tierMax: parseTierMax(rest),
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
        if (body.includes('packages/measures/src/_runners/capture-ci-checks.ts')) {
            result.set(name, parseCaptureFlags(body))
        }
    }

    for (let pass = 0; pass < 5; pass++) {
        let added = false
        for (const [name, body] of Object.entries(scripts)) {
            if (result.has(name)) continue
            for (const match of body.matchAll(/npm run ([a-z0-9:_-]+)/gi)) {
                const target = match[1]
                if (target === name) continue
                const resolved = result.get(target)
                if (!resolved) continue
                result.set(name, resolved)
                added = true
                break
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
    const directRe = /npm run measures:capture-ci(?![a-z0-9:_-])(?:\s+--\s+([^\n]*))?/gi
    for (const match of workflowText.matchAll(directRe)) {
        calls.push({workflow, ...parseCaptureFlags(match[1] ?? '')})
    }
    // Direct node invocations of capture-ci-checks.ts in workflow `run:` blocks,
    // including bash line-continuations (`\` + newline) used by the generated
    // measures workflow.
    const joined = workflowText.replace(/\\\n\s*/g, ' ')
    const nodeRe = /capture-ci-checks\.ts\s+([^\n]+)/gi
    for (const match of joined.matchAll(nodeRe)) {
        calls.push({workflow, ...parseCaptureFlags(match[1])})
    }
    const indirectRe = /npm run ([a-z0-9:_-]+)/gi
    for (const match of workflowText.matchAll(indirectRe)) {
        const name = match[1]
        if (name === 'measures:capture-ci') continue
        const resolved = scripts.get(name)
        if (resolved) calls.push({workflow, ...resolved})
    }
    return calls
}

function callCoversCheck(call: CaptureCall, check: ScheduledCheck): boolean {
    if (call.only) return call.only.has(check.id)
    return call.tierMax === null || check.tier <= call.tierMax
}

async function loadAllCalls(scripts: ReadonlyMap<string, CaptureFlags>): Promise<readonly CaptureCall[]> {
    const workflowFiles = await readdir(WORKFLOWS_DIR)
    const calls: CaptureCall[] = []
    for (const workflow of workflowFiles) {
        if (!workflow.endsWith('.yml') && !workflow.endsWith('.yaml')) continue
        const text = await readFile(join(WORKFLOWS_DIR, workflow), 'utf8')
        calls.push(...findCaptureInvocations(text, scripts, workflow))
    }
    return calls
}

function formatCall(call: CaptureCall): string {
    const scope = call.only
        ? `only=${[...call.only].sort().join(',')}`
        : call.tierMax === null ? 'full' : `tier<=${call.tierMax}`
    return `${call.workflow}: ${scope}`
}

describe('CI coverage of packages/measures/checks', () => {
    it('every scheduled check is invoked by at least one GitHub Actions workflow', async () => {
        const [checks, scripts] = await Promise.all([loadScheduledChecks(), loadCaptureScripts()])
        const allCalls = await loadAllCalls(scripts)
        const uncovered = checks.filter(check => !allCalls.some(call => callCoversCheck(call, check)))

        if (uncovered.length > 0) {
            const checkLines = uncovered.map(check => `  - ${check.relPath}  (id=${check.id}, tier=${check.tier})`)
            const callLines = allCalls.length === 0
                ? ['  (none - no workflow invokes capture-ci-checks.ts directly or via an npm script that does)']
                : [...new Set(allCalls.map(formatCall))].sort().map(s => `  - ${s}`)
            throw new Error(
                `${uncovered.length}/${checks.length} scheduled checks are not invoked by any GitHub Actions workflow.\n\n` +
                `Uncovered checks:\n${checkLines.join('\n')}\n\n` +
                `capture-ci-checks invocations detected in .github/workflows/:\n${callLines.join('\n')}\n\n` +
                `Fix: add a workflow step that invokes capture-ci-checks directly or through ` +
                `npm run test:tN / npm run test:full covering each scheduled check.`,
            )
        }
        expect(uncovered).toHaveLength(0)
    })
})
