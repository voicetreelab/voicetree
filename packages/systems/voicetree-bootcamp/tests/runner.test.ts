/**
 * Black-box tests for `runScenario` — feed a fake driver + minimal scenario
 * and assert the returned CellResult shape (telemetry, coverage, attempts,
 * success, breakdown). No mocks of internals.
 *
 * The fake driver implements the real `HarnessDriver` interface: it writes
 * known shim-log entries to the runner-allocated shim-log dir (the same way
 * the real `vt-shim` does), so scoring + coverage are computed end-to-end
 * against real shim parsing. wallClockMs is fixed so the timeEff dim is
 * deterministic.
 */
import {promises as fs} from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {runScenario} from '../src/runner.ts'
import {agentFinishedInListJson} from '../src/runner.ts'
import type {HarnessDriver, ScenarioSpec, ShimLogEntry} from '../src/types.ts'

const FIXED_WALL_MS = 12_345

function makeFakeDriver(plan: {
    readonly entries: readonly Partial<ShimLogEntry>[]
    readonly telemetry: {
        readonly inputTokens: number
        readonly outputTokens: number
        readonly toolCallCount: number
    }
    readonly transcript?: string
}): HarnessDriver {
    return {
        name: 'claude',
        models: ['fake'],
        runScenario: async (opts) => {
            const shimLogDir = opts.env.VT_SHIM_LOG_DIR
            if (!shimLogDir) {
                throw new Error('fake driver: VT_SHIM_LOG_DIR not set in env')
            }
            for (let i = 0; i < plan.entries.length; i++) {
                const partial = plan.entries[i]
                const entry: ShimLogEntry = {
                    timestampMs: i + 1,
                    argv: ['graph', 'create'],
                    cwd: opts.cwd,
                    exitCode: 0,
                    stderr: '',
                    durationMs: 1,
                    ...partial,
                }
                const filename = `${String(entry.timestampMs).padStart(13, '0')}-fake-${i}.json`
                await fs.writeFile(
                    path.join(shimLogDir, filename),
                    `${JSON.stringify(entry)}\n`,
                )
            }
            const transcriptPath = path.join(opts.artifactDir, 'transcript.txt')
            await fs.writeFile(transcriptPath, plan.transcript ?? 'fake transcript')
            return {
                transcriptPath,
                telemetry: {...plan.telemetry, wallClockMs: FIXED_WALL_MS},
                exitInfo: {code: 0, signal: null},
            }
        },
    }
}

function makeScenario(overrides: Partial<ScenarioSpec> = {}): ScenarioSpec {
    return {
        id: 'TEST',
        name: 'fake scenario',
        setup: async (vaultDir) => {
            await fs.writeFile(path.join(vaultDir, 'a.md'), '# a\n')
        },
        taskPrompt: 'do the thing',
        expectedCommands: [{verb: 'graph create'}, {verb: 'graph structure'}],
        successCriteria: async (vaultDir) => {
            const exists = await fs
                .stat(path.join(vaultDir, 'a.md'))
                .then(() => true)
                .catch(() => false)
            return {passed: exists, detail: exists ? 'a.md present' : 'a.md missing'}
        },
        budgets: {
            tokens: 10_000,
            toolCalls: 50,
            vtInvocations: 10,
            seconds: 60,
        },
        ...overrides,
    }
}

describe('runScenario — headless', () => {
    let workspaceRoot: string

    beforeEach(async () => {
        workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-bootcamp-runner-test-'))
    })
    afterEach(async () => {
        await fs.rm(workspaceRoot, {recursive: true, force: true})
    })

    it('returns a CellResult with telemetry, attempts, success, coverage, breakdown', async () => {
        const driver = makeFakeDriver({
            entries: [
                {argv: ['graph', 'create', '--filename', 'a.md']},
                {argv: ['graph', 'structure']},
            ],
            telemetry: {inputTokens: 800, outputTokens: 200, toolCallCount: 4},
        })
        const result = await runScenario({
            scenario: makeScenario(),
            driver,
            model: 'fake',
            effort: 'low',
            workspaceRoot,
        })

        expect(result.scenarioId).toBe('TEST')
        expect(result.model).toBe('fake')
        expect(result.rep).toBe(0)
        expect(result.telemetry.inputTokens).toBe(800)
        expect(result.telemetry.outputTokens).toBe(200)
        expect(result.telemetry.toolCallCount).toBe(4)
        expect(result.telemetry.wallClockMs).toBe(FIXED_WALL_MS)
        expect(result.telemetry.vtInvocationCount).toBe(2)
        expect(result.attempts).toHaveLength(2)
        expect(result.attempts[0].outcome).toBe('first-try-correct')
        expect(result.attempts[1].outcome).toBe('first-try-correct')
        expect(result.success.passed).toBe(true)
        expect(result.coverage.passed).toBe(true)
        expect(result.coverage.missingVerbs).toEqual([])
        expect(result.breakdown.successGate).toBe(1)
        expect(result.breakdown.coverageGate).toBe(1)
        expect(result.breakdown.fitness).toBeGreaterThan(0)
        expect(result.breakdown.correctness).toBe(1)
    })

    it('canonicalises vtInvocationCount from the shim-log file count', async () => {
        // Driver claims toolCallCount=999 but writes only 3 shim entries.
        // vtInvocationCount must reflect the on-disk truth, not the driver
        // claim — that's the whole reason the shim log is canonical.
        const driver = makeFakeDriver({
            entries: [
                {argv: ['graph', 'create', '-f', 'a.md']},
                {argv: ['graph', 'create', '-f', 'b.md']},
                {argv: ['graph', 'structure']},
            ],
            telemetry: {inputTokens: 0, outputTokens: 0, toolCallCount: 999},
        })
        const result = await runScenario({
            scenario: makeScenario(),
            driver,
            model: 'fake',
            effort: 'low',
            workspaceRoot,
        })
        expect(result.telemetry.vtInvocationCount).toBe(3)
        expect(result.telemetry.toolCallCount).toBe(999)
    })

    it('coverage gate fails when an expected verb is missing — fitness collapses to 0', async () => {
        const driver = makeFakeDriver({
            entries: [
                // graph structure is missing entirely
                {argv: ['graph', 'create', '-f', 'a.md']},
            ],
            telemetry: {inputTokens: 100, outputTokens: 50, toolCallCount: 1},
        })
        const result = await runScenario({
            scenario: makeScenario(),
            driver,
            model: 'fake',
            effort: 'low',
            workspaceRoot,
        })
        expect(result.coverage.passed).toBe(false)
        expect(result.coverage.missingVerbs).toEqual(['graph structure'])
        expect(result.breakdown.coverageGate).toBe(0)
        expect(result.breakdown.fitness).toBe(0)
        // breakdown still surfaces the per-dim values for remediation
        expect(result.breakdown.correctness).toBeGreaterThan(0)
        expect(result.breakdown.geomean).toBeGreaterThan(0)
    })

    it('success gate fails when successCriteria.passed=false — fitness collapses to 0', async () => {
        const driver = makeFakeDriver({
            entries: [
                {argv: ['graph', 'create', '-f', 'a.md']},
                {argv: ['graph', 'structure']},
            ],
            telemetry: {inputTokens: 100, outputTokens: 50, toolCallCount: 2},
        })
        const scenario = makeScenario({
            successCriteria: async () => ({passed: false, detail: 'forced failure'}),
        })
        const result = await runScenario({
            scenario,
            driver,
            model: 'fake',
            effort: 'low',
            workspaceRoot,
        })
        expect(result.success.passed).toBe(false)
        expect(result.success.detail).toBe('forced failure')
        expect(result.breakdown.successGate).toBe(0)
        expect(result.breakdown.coverageGate).toBe(1)
        expect(result.breakdown.fitness).toBe(0)
    })

    it('retry-after-failure outcome surfaces when first invocation fails', async () => {
        const driver = makeFakeDriver({
            entries: [
                {argv: ['graph', 'create'], exitCode: 1, stderr: 'missing --filename'},
                {argv: ['graph', 'create', '-f', 'a.md'], exitCode: 0},
                {argv: ['graph', 'structure'], exitCode: 0},
            ],
            telemetry: {inputTokens: 100, outputTokens: 50, toolCallCount: 3},
        })
        const result = await runScenario({
            scenario: makeScenario(),
            driver,
            model: 'fake',
            effort: 'low',
            workspaceRoot,
        })
        expect(result.attempts[0].outcome).toBe('retry-after-failure')
        expect(result.attempts[0].evidence).toHaveLength(2)
        expect(result.success.passed).toBe(true)
        expect(result.breakdown.correctness).toBeCloseTo((0.4 + 1) / 2)
    })

    it('teardown runs in finally{} even when successCriteria throws', async () => {
        let teardownRan = false
        const driver = makeFakeDriver({
            entries: [{argv: ['graph', 'create']}],
            telemetry: {inputTokens: 0, outputTokens: 0, toolCallCount: 0},
        })
        const scenario = makeScenario({
            successCriteria: async () => {
                throw new Error('boom')
            },
            teardown: async () => {
                teardownRan = true
            },
        })
        await expect(
            runScenario({
                scenario,
                driver,
                model: 'fake',
                effort: 'low',
                workspaceRoot,
            }),
        ).rejects.toThrow('boom')
        expect(teardownRan).toBe(true)
    })

    it('passes rep through to the CellResult', async () => {
        const driver = makeFakeDriver({
            entries: [
                {argv: ['graph', 'create', '-f', 'a.md']},
                {argv: ['graph', 'structure']},
            ],
            telemetry: {inputTokens: 0, outputTokens: 0, toolCallCount: 0},
        })
        const result = await runScenario({
            scenario: makeScenario(),
            driver,
            model: 'fake',
            effort: 'low',
            rep: 7,
            workspaceRoot,
        })
        expect(result.rep).toBe(7)
    })

    it('writes the transcript and points CellResult.transcriptPath at it', async () => {
        const driver = makeFakeDriver({
            entries: [
                {argv: ['graph', 'create', '-f', 'a.md']},
                {argv: ['graph', 'structure']},
            ],
            telemetry: {inputTokens: 0, outputTokens: 0, toolCallCount: 0},
            transcript: 'hello transcript',
        })
        const result = await runScenario({
            scenario: makeScenario(),
            driver,
            model: 'fake',
            effort: 'low',
            workspaceRoot,
        })
        const content = await fs.readFile(result.transcriptPath, 'utf8')
        expect(content).toBe('hello transcript')
    })

    it('shimLogPath points at a directory containing the per-call .json files', async () => {
        const driver = makeFakeDriver({
            entries: [
                {argv: ['graph', 'create', '-f', 'a.md']},
                {argv: ['graph', 'create', '-f', 'b.md']},
                {argv: ['graph', 'structure']},
            ],
            telemetry: {inputTokens: 0, outputTokens: 0, toolCallCount: 0},
        })
        const result = await runScenario({
            scenario: makeScenario(),
            driver,
            model: 'fake',
            effort: 'low',
            workspaceRoot,
        })
        const files = await fs.readdir(result.shimLogPath)
        const jsonFiles = files.filter((f) => f.endsWith('.json'))
        expect(jsonFiles).toHaveLength(3)
    })
})

describe('runScenario — headful', () => {
    let workspaceRoot: string

    beforeEach(async () => {
        workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-bootcamp-runner-test-'))
    })
    afterEach(async () => {
        await fs.rm(workspaceRoot, {recursive: true, force: true})
    })

    it("errors clearly when mode='headful' is used without headfulParentNodeId", async () => {
        // The driver in headful mode is unused but still required by the
        // shape — pass a stub that will throw if it ever gets called.
        const stubDriver: HarnessDriver = {
            name: 'claude',
            models: ['fake'],
            runScenario: async () => {
                throw new Error('driver should not be invoked in headful mode')
            },
        }
        await expect(
            runScenario({
                scenario: makeScenario(),
                driver: stubDriver,
                model: 'fake',
                effort: 'low',
                mode: 'headful',
                workspaceRoot,
            }),
        ).rejects.toThrow(/headfulParentNodeId is required/)
    })
})

describe('agentFinishedInListJson', () => {
    it('treats "running" as not finished', () => {
        const json = JSON.stringify({
            agents: [{terminalId: 'T1', status: 'running'}],
        })
        expect(agentFinishedInListJson(json, 'T1')).toBe(false)
    })

    it('treats "completed" as finished', () => {
        const json = JSON.stringify({
            agents: [{terminalId: 'T1', status: 'completed'}],
        })
        expect(agentFinishedInListJson(json, 'T1')).toBe(true)
    })

    it('treats agent absent from the list as finished', () => {
        const json = JSON.stringify({
            agents: [{terminalId: 'OTHER', status: 'running'}],
        })
        expect(agentFinishedInListJson(json, 'T1')).toBe(true)
    })

    it('returns false on malformed JSON (so we keep polling rather than declare done)', () => {
        expect(agentFinishedInListJson('not json', 'T1')).toBe(false)
    })

    it('accepts top-level array shape too', () => {
        const json = JSON.stringify([{terminalId: 'T1', status: 'running'}])
        expect(agentFinishedInListJson(json, 'T1')).toBe(false)
    })
})
