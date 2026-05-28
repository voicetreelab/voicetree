import {describe, expect, it} from 'vitest'
import {aggregateScore, scoreCommand, scoreScenario} from '../src/scoring.ts'
import type {CommandPattern, ShimLogEntry} from '../src/types.ts'

const GRAPH_CREATE: CommandPattern = {verb: 'graph create'}
const GRAPH_STRUCTURE: CommandPattern = {verb: 'graph structure'}

function entry(overrides: Partial<ShimLogEntry> = {}): ShimLogEntry {
    return {
        timestampMs: 0,
        argv: ['graph', 'create'],
        cwd: '/tmp',
        exitCode: 0,
        stderr: '',
        durationMs: 10,
        ...overrides,
    }
}

describe('scoreCommand', () => {
    it('returns first-try-correct when the first matching invocation succeeds', () => {
        const log = [entry({argv: ['graph', 'create', '--filename', 'x.md']})]
        const attempt = scoreCommand(GRAPH_CREATE, log)
        expect(attempt.outcome).toBe('first-try-correct')
    })

    it('returns retry-after-failure when first fails but a later one succeeds', () => {
        const log = [
            entry({argv: ['graph', 'create'], exitCode: 1, stderr: 'missing arg'}),
            entry({argv: ['graph', 'create', '--filename', 'x.md'], exitCode: 0}),
        ]
        const attempt = scoreCommand(GRAPH_CREATE, log)
        expect(attempt.outcome).toBe('retry-after-failure')
    })

    it('returns abandoned when no invocation succeeds', () => {
        const log = [
            entry({argv: ['graph', 'create'], exitCode: 1}),
            entry({argv: ['graph', 'create'], exitCode: 2}),
        ]
        const attempt = scoreCommand(GRAPH_CREATE, log)
        expect(attempt.outcome).toBe('abandoned')
    })

    it('returns abandoned when no invocation matches the verb at all', () => {
        const log = [entry({argv: ['graph', 'structure']})]
        const attempt = scoreCommand(GRAPH_CREATE, log)
        expect(attempt.outcome).toBe('abandoned')
        expect(attempt.evidence).toEqual([])
    })

    it('ignores flag arguments when matching the verb', () => {
        const log = [entry({argv: ['--port', '4001', 'graph', 'create']})]
        const attempt = scoreCommand(GRAPH_CREATE, log)
        expect(attempt.outcome).toBe('first-try-correct')
    })

    it('does not match a longer verb against a shorter argv prefix', () => {
        const log = [entry({argv: ['graph']})]
        const attempt = scoreCommand(GRAPH_CREATE, log)
        expect(attempt.outcome).toBe('abandoned')
    })
})

describe('scoreScenario', () => {
    it('averages per-command scores', () => {
        const log = [
            entry({argv: ['graph', 'create'], exitCode: 0}),
            entry({argv: ['graph', 'structure'], exitCode: 1}),
        ]
        const {meanScore, attempts} = scoreScenario([GRAPH_CREATE, GRAPH_STRUCTURE], log)
        expect(attempts).toHaveLength(2)
        expect(attempts[0].outcome).toBe('first-try-correct')
        expect(attempts[1].outcome).toBe('abandoned')
        expect(meanScore).toBeCloseTo(0.5)
    })

    it('returns 0 when no commands are expected', () => {
        expect(aggregateScore([])).toBe(0)
    })
})
