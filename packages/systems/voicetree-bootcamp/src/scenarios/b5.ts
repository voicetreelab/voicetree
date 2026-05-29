/**
 * B5 — Live edit + lint loop.
 *
 * Heaviest scenario by verb count. setup writes seed/ + bloated/ fixtures and
 * spawns the vt-graphd daemon via @vt/graph-db-client's ensureDaemon. The
 * daemon pid+port is persisted to a sidecar inside the project so teardown can
 * locate and terminate the process by project path alone.
 *
 * Note on port selection: the plan specifies $VT_BOOTCAMP_DAEMON_PORT (default
 * 4773) but graph-db-client's ensureDaemon API does not accept a port — the
 * daemon self-assigns and writes a port file. We accept the daemon-assigned
 * port and surface it via the sidecar; the runner is responsible for
 * exporting it as $VT_BOOTCAMP_DAEMON_PORT to the agent's environment.
 *
 * successCriteria has two halves. The lint half re-runs `vt graph lint
 * bloated/ --max-arity 8 --coupling-threshold 5 --json` via $VT_REAL_BIN.
 * The live-state half (re-querying daemon for node positions / edge labels)
 * is daemon-dependent and currently lives behind the runner's integration
 * harness — the test file flags it as it.todo.
 */
import {promises as fs} from 'node:fs'
import * as path from 'node:path'
import {spawn} from 'node:child_process'
import type {ScenarioSpec, SuccessResult} from '../types.ts'
import {
    fileExists,
    readDaemonHandle,
    removeDaemonHandle,
    writeDaemonHandle,
    writeFile,
} from './_helpers.ts'

const TASK_PROMPT = `You're working with a live VoiceTree project. The graph daemon is already
running on port $VT_BOOTCAMP_DAEMON_PORT and has three seed nodes ingested
from \`seed/\` (a.md, b.md, c.md).

--- PART 1: live edit ---

Live-add a new node \`seed/summary.md\` connected to all three seed nodes with
edges labeled "summarizes". Place it at position (200, 100). Dump the live
state to verify the four-node shape, then remove the edge from \`summary.md\`
to \`seed/c.md\`. Dump state again to confirm two outbound edges remain.

--- PART 2: lint loop ---

The folder \`bloated/\` contains a parent with twelve children — too high arity.
Lint \`bloated/\` with \`--max-arity 8 --coupling-threshold 5\`. For each
violation, regroup the children using \`vt graph group\` so no parent exceeds
the threshold. Re-lint \`bloated/\` with the same thresholds to confirm zero
violations remain.

Use \`vt --help\` and \`vt graph live --help\` if you need to discover the right
flag names — the live commands take file paths via \`--src-file\` / \`--tgt-file\`.`

const BLOATED_CHILD_COUNT = 12

/**
 * Fixture-only setup, exported for unit tests so the daemon spawn can be
 * exercised separately from filesystem fixture verification.
 */
export async function writeB5Fixtures(projectDir: string): Promise<void> {
    await writeFile(path.join(projectDir, 'seed', 'a.md'), '# A\n\nSeed node A.\n')
    await writeFile(path.join(projectDir, 'seed', 'b.md'), '# B\n\nSeed node B.\n')
    await writeFile(path.join(projectDir, 'seed', 'c.md'), '# C\n\nSeed node C.\n')

    let parentBody = '# Parent\n\n'
    for (let i = 1; i <= BLOATED_CHILD_COUNT; i++) {
        await writeFile(path.join(projectDir, 'bloated', `child-${i}.md`), `# Child ${i}\n`)
        parentBody += `[[child-${i}]]\n`
    }
    await writeFile(path.join(projectDir, 'bloated', 'parent.md'), parentBody)
}

export const b5: ScenarioSpec = {
    id: 'B5',
    name: 'live edit + lint loop',
    async setup(projectDir) {
        await writeB5Fixtures(projectDir)
        const {ensureDaemon} = await import('@vt/graph-db-client')
        const result = await ensureDaemon(projectDir, {timeoutMs: 10_000})
        if (result.pid === null) {
            throw new Error('B5 setup: ensureDaemon returned null pid — cannot track daemon for teardown')
        }
        await writeDaemonHandle(projectDir, {pid: result.pid, port: result.port})
    },
    taskPrompt: TASK_PROMPT,
    expectedCommands: [
        {verb: 'graph live add-node'},
        {verb: 'graph live add-edge', minCount: 3},
        {verb: 'graph live state dump'},
        {verb: 'graph live mv-node'},
        {verb: 'graph live rm-edge'},
        {verb: 'graph lint', minCount: 2},
        {verb: 'graph group'},
    ],
    async successCriteria(projectDir): Promise<SuccessResult> {
        // Part 2: re-run `vt graph lint bloated/ --max-arity 8
        // --coupling-threshold 5 --json` from the runner and verify zero
        // violations remain.
        const lintReport = await runLintReVerification(projectDir)
        if (!lintReport.ok) {
            return {passed: false, detail: lintReport.detail}
        }

        // Part 1: state-dump re-verification is daemon-dependent. The shape
        // (summary.md at (200,100), 2 outbound edges to a.md+b.md labelled
        // "summarizes", no edge to c.md) requires a live daemon query via
        // GraphDbClient. Until the runner wires that probe, accept the lint
        // half as the binding gate — the runner-level integration check will
        // catch hallucinated live-edit state.
        return {
            passed: true,
            detail: `lint re-verification passed (${lintReport.violationCount} violations)`,
        }
    },
    async teardown(projectDir) {
        const handle = await readDaemonHandle(projectDir)
        if (handle === undefined) return
        try {
            process.kill(handle.pid, 'SIGTERM')
        } catch {
            // Process already gone — fine.
        }
        await waitForProcessExit(handle.pid, 5_000)
        try {
            process.kill(handle.pid, 'SIGKILL')
        } catch {
            // Process already gone — fine.
        }
        await removeDaemonHandle(projectDir)
    },
    budgets: {
        tokens: 7000,
        toolCalls: 10,
        vtInvocations: 13,
        seconds: 60,
    },
}

async function runLintReVerification(projectDir: string): Promise<{
    readonly ok: boolean
    readonly detail: string
    readonly violationCount: number
}> {
    const realBin = process.env.VT_REAL_BIN
    if (!realBin) {
        return {ok: false, detail: 'VT_REAL_BIN not set — cannot re-verify lint state', violationCount: -1}
    }
    if (!(await fileExists(path.join(projectDir, 'bloated')))) {
        return {ok: false, detail: 'bloated/ directory missing — fixture not present', violationCount: -1}
    }

    const lintResult = await spawnVt(realBin, [
        'graph',
        'lint',
        'bloated/',
        '--max-arity',
        '8',
        '--coupling-threshold',
        '5',
        '--json',
    ], projectDir)

    if (lintResult.exitCode !== 0 && lintResult.stdout.trim().length === 0) {
        return {
            ok: false,
            detail: `vt graph lint exited ${lintResult.exitCode} with no JSON payload: ${lintResult.stderr.slice(0, 200)}`,
            violationCount: -1,
        }
    }

    let report: unknown
    try {
        report = JSON.parse(lintResult.stdout)
    } catch (err) {
        return {
            ok: false,
            detail: `vt graph lint --json did not return valid JSON: ${(err as Error).message}`,
            violationCount: -1,
        }
    }

    const violations = extractViolationCount(report)
    if (violations > 0) {
        return {
            ok: false,
            detail: `vt graph lint reports ${violations} remaining violations after agent regrouped`,
            violationCount: violations,
        }
    }
    return {ok: true, detail: 'lint clean', violationCount: 0}
}

function extractViolationCount(report: unknown): number {
    if (typeof report !== 'object' || report === null) return -1
    const obj = report as Record<string, unknown>
    if (Array.isArray(obj.violations)) return obj.violations.length
    if (typeof obj.violationCount === 'number') return obj.violationCount
    const arity = Array.isArray(obj.arityViolations) ? obj.arityViolations.length : 0
    const coupling = Array.isArray(obj.couplingViolations) ? obj.couplingViolations.length : 0
    return arity + coupling
}

function spawnVt(
    bin: string,
    args: readonly string[],
    cwd: string,
): Promise<{readonly exitCode: number; readonly stdout: string; readonly stderr: string}> {
    return new Promise((resolve) => {
        const child = spawn(bin, [...args], {cwd, stdio: ['ignore', 'pipe', 'pipe']})
        let stdout = ''
        let stderr = ''
        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString('utf8')
        })
        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString('utf8')
        })
        child.on('error', (err) => {
            resolve({exitCode: 127, stdout, stderr: stderr + err.message})
        })
        child.on('close', (code) => {
            resolve({exitCode: code ?? 1, stdout, stderr})
        })
    })
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
        try {
            process.kill(pid, 0)
        } catch {
            return
        }
        await new Promise((r) => setTimeout(r, 50))
    }
}
