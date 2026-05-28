/**
 * Black-box tests for the report layer. Pure functions in (CellResult
 * fixtures), strings out. Color is disabled via the explicit
 * {color: false} option — the renderer doesn't read process.stdout, so
 * the harness is fully deterministic.
 */
import {describe, expect, it} from 'vitest'
import {renderCellResult, renderCellResults} from '../src/report.ts'
import type {
    CellResult,
    CheckpointResult,
    CommandAttempt,
    Coverage,
    FitnessBreakdown,
    RunTelemetry,
    SuccessResult,
} from '../src/types.ts'

const TELEMETRY: RunTelemetry = {
    inputTokens: 124_000,
    outputTokens: 45_000,
    toolCallCount: 180,
    vtInvocationCount: 282,
    wallClockMs: 423_000,
}

const PASSING_BREAKDOWN: FitnessBreakdown = {
    correctness: 1,
    vtEff: 0.85,
    tokenEff: 0.92,
    toolEff: 0.88,
    timeEff: 0.77,
    completion: 1,
    geomean: 0.89,
    successGate: 1,
    coverageGate: 1,
    fitness: 0.89,
}

const FAILING_BREAKDOWN: FitnessBreakdown = {
    ...PASSING_BREAKDOWN,
    successGate: 0,
    fitness: 0,
}

const FULL_COVERAGE: Coverage = {passed: true, missingVerbs: []}

function attempt(
    verb: string,
    outcome: CommandAttempt['outcome']
): CommandAttempt {
    return {expected: {verb}, outcome, evidence: []}
}

function passingCell(overrides: Partial<CellResult> = {}): CellResult {
    return {
        scenarioId: 'B7',
        model: 'claude-opus-4-7',
        rep: 1,
        telemetry: TELEMETRY,
        shimLogPath: '/tmp/bootcamp/cell-001/shim-log/',
        transcriptPath: '/tmp/bootcamp/cell-001/transcript.txt',
        attempts: [
            attempt('graph create', 'first-try-correct'),
            attempt('graph structure', 'first-try-correct'),
            attempt('graph link', 'first-try-correct'),
        ],
        success: {passed: true, detail: '135 leaves, 12 folders'},
        coverage: FULL_COVERAGE,
        breakdown: PASSING_BREAKDOWN,
        ...overrides,
    }
}

describe('renderCellResult', () => {
    it('renders a passing cell with header, badge, coverage, attempts, fitness, artifacts', () => {
        const out = renderCellResult(passingCell())

        expect(out).toContain('B7 · claude-opus-4-7 · rep 1')
        expect(out).toContain('✓ PASSED — 135 leaves, 12 folders')
        expect(out).toContain('Coverage: 3/3 verbs (missing: none)')
        expect(out).toContain('Attempts:')
        expect(out).toContain('graph create: first-try-correct')
        expect(out).toContain('graph link: first-try-correct')
        expect(out).toContain(
            'tokens=124000/45000 · tool calls=180 · vt invocations=282 · wallclock=423.0s'
        )
        expect(out).toContain('correctness=1.00 · vt_eff=0.85')
        expect(out).toContain('fitness=0.89')
        expect(out).toContain('transcript: /tmp/bootcamp/cell-001/transcript.txt')
        expect(out).toContain('shim log:   /tmp/bootcamp/cell-001/shim-log/')
    })

    it('renders a failing cell with ✗ FAILED badge and fitness=0.00', () => {
        const cell = passingCell({
            success: {passed: false, detail: 'missing 1 leaf'},
            breakdown: FAILING_BREAKDOWN,
        })
        const out = renderCellResult(cell)

        expect(out).toContain('✗ FAILED — missing 1 leaf')
        expect(out).toContain('success=0')
        expect(out).toContain('fitness=0.00')
        expect(out).not.toContain('✓ PASSED')
    })

    it('lists checkpoints under the badge for partial-credit scenarios (B7 shape)', () => {
        const checkpoints: readonly CheckpointResult[] = [
            {name: 'bulk-create', passed: true, detail: '135 leaf files exist'},
            {name: 'regroup', passed: true, detail: '12 folder notes'},
            {
                name: 'folder-notes',
                passed: false,
                detail: '134/135 leaves wikilinked',
            },
        ]
        const success: SuccessResult = {
            passed: false,
            detail: '1 checkpoint failed',
            checkpoints,
        }
        const cell = passingCell({
            success,
            breakdown: FAILING_BREAKDOWN,
        })
        const out = renderCellResult(cell)

        expect(out).toContain('Checkpoints:')
        expect(out).toContain('✓ bulk-create — 135 leaf files exist')
        expect(out).toContain('✓ regroup — 12 folder notes')
        expect(out).toContain('✗ folder-notes — 134/135 leaves wikilinked')
    })

    it('omits the Checkpoints block for single-gate scenarios (B1–B6 shape)', () => {
        const out = renderCellResult(passingCell())
        expect(out).not.toContain('Checkpoints:')
    })

    it('lists missing verbs when coverage is incomplete', () => {
        const cell = passingCell({
            coverage: {passed: false, missingVerbs: ['graph link', 'graph delete']},
            attempts: [
                attempt('graph create', 'first-try-correct'),
                attempt('graph structure', 'first-try-correct'),
                attempt('graph link', 'abandoned'),
                attempt('graph delete', 'abandoned'),
            ],
        })
        const out = renderCellResult(cell)

        expect(out).toContain('Coverage: 2/4 verbs (missing: graph link, graph delete)')
        expect(out).toContain('graph link: abandoned')
    })

    it('emits ANSI color codes when color=true and plain text when color=false', () => {
        const cell = passingCell()
        const colored = renderCellResult(cell, {color: true})
        const plain = renderCellResult(cell, {color: false})

        expect(colored).toContain('\x1b[32m✓ PASSED')
        expect(colored).toContain('\x1b[0m')
        expect(plain).not.toContain('\x1b[')
    })
})

describe('renderCellResults', () => {
    it('opens with a summary line counting passed vs failed cells', () => {
        const results = [
            passingCell({rep: 1}),
            passingCell({
                rep: 2,
                success: {passed: false, detail: 'x'},
                breakdown: FAILING_BREAKDOWN,
            }),
            passingCell({rep: 3}),
        ]
        const out = renderCellResults(results)
        expect(out.split('\n')[0]).toBe('3 cells: 2 passed, 1 failed')
    })

    it('separates per-cell blocks with --- rules', () => {
        const results = [
            passingCell({rep: 1, model: 'claude-opus-4-7'}),
            passingCell({rep: 1, model: 'claude-sonnet-4-6'}),
        ]
        const out = renderCellResults(results)
        // No multi-rep aggregation here (different models) — so: summary + 2 cells.
        expect(out.split('\n---\n').length).toBe(3)
    })

    it('shows mean + stddev aggregation for multi-rep groups', () => {
        const results: CellResult[] = [0.8, 0.9, 1.0].map((f, i) =>
            passingCell({
                rep: i + 1,
                breakdown: {...PASSING_BREAKDOWN, fitness: f},
            })
        )
        const out = renderCellResults(results)

        expect(out).toContain('Aggregated fitness (multi-rep groups):')
        expect(out).toContain('B7 · claude-opus-4-7: mean=0.90 stddev=0.08 (n=3)')
    })

    it('omits the aggregation block when every group has only one rep', () => {
        const results = [
            passingCell({rep: 1, model: 'claude-opus-4-7'}),
            passingCell({rep: 1, model: 'claude-sonnet-4-6'}),
        ]
        const out = renderCellResults(results)
        expect(out).not.toContain('Aggregated fitness')
    })

    it('counts a coverage-failed cell as failed even when success.passed is true', () => {
        const results = [
            passingCell({
                rep: 1,
                coverage: {passed: false, missingVerbs: ['graph link']},
            }),
        ]
        const out = renderCellResults(results)
        expect(out.split('\n')[0]).toBe('1 cells: 0 passed, 1 failed')
    })
})
