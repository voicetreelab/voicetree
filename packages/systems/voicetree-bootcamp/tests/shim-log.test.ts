import {describe, expect, it} from 'vitest'
import {matchesVerb, parseShimLog} from '../src/shim-log.ts'

describe('parseShimLog', () => {
    it('parses well-formed JSONL', () => {
        const raw = [
            JSON.stringify({timestampMs: 1, argv: ['graph', 'create'], cwd: '/tmp', exitCode: 0, stderr: '', durationMs: 5}),
            JSON.stringify({timestampMs: 2, argv: ['graph', 'structure'], cwd: '/tmp', exitCode: 0, stderr: '', durationMs: 6}),
        ].join('\n')
        const entries = parseShimLog(raw)
        expect(entries).toHaveLength(2)
        expect(entries[0].argv).toEqual(['graph', 'create'])
    })

    it('skips blank and malformed lines silently', () => {
        const raw = [
            JSON.stringify({timestampMs: 1, argv: ['graph', 'create'], cwd: '/tmp', exitCode: 0, stderr: '', durationMs: 5}),
            '',
            'not json',
            '{"missing": "fields"}',
            JSON.stringify({timestampMs: 2, argv: ['graph', 'structure'], cwd: '/tmp', exitCode: 0, stderr: '', durationMs: 6}),
        ].join('\n')
        const entries = parseShimLog(raw)
        expect(entries).toHaveLength(2)
    })

    it('returns empty for empty input', () => {
        expect(parseShimLog('')).toEqual([])
    })
})

describe('matchesVerb', () => {
    const baseEntry = {timestampMs: 0, cwd: '/tmp', exitCode: 0, stderr: '', durationMs: 1}

    it('matches a two-word verb against argv positionals', () => {
        expect(matchesVerb({...baseEntry, argv: ['graph', 'create']}, 'graph create')).toBe(true)
    })

    it('ignores leading flag args when matching', () => {
        expect(matchesVerb({...baseEntry, argv: ['--port', '4001', 'graph', 'create']}, 'graph create')).toBe(true)
    })

    it('does not match when verb is longer than argv positionals', () => {
        expect(matchesVerb({...baseEntry, argv: ['graph']}, 'graph create')).toBe(false)
    })

    it('does not match when first positional differs', () => {
        expect(matchesVerb({...baseEntry, argv: ['agent', 'spawn']}, 'graph create')).toBe(false)
    })
})
