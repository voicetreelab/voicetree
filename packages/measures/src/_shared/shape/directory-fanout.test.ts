import {describe, expect, it} from 'vitest'
import {
    MAX_DIRECTORY_CHILDREN,
    findFanoutViolations,
    formatFanoutReport,
} from './directory-fanout.ts'

describe('findFanoutViolations', () => {
    it('returns empty when every directory is at or below the limit', () => {
        expect(findFanoutViolations([
            {directory: 'a', childCount: MAX_DIRECTORY_CHILDREN, children: []},
            {directory: 'b', childCount: 0, children: []},
        ])).toEqual([])
    })

    it('flags directories strictly over the limit, sorted by count desc then name', () => {
        const result = findFanoutViolations([
            {directory: 'small', childCount: 5, children: []},
            {directory: 'b', childCount: MAX_DIRECTORY_CHILDREN + 1, children: []},
            {directory: 'a', childCount: MAX_DIRECTORY_CHILDREN + 1, children: []},
            {directory: 'huge', childCount: MAX_DIRECTORY_CHILDREN + 10, children: []},
        ])
        expect(result.map(v => v.directory)).toEqual(['huge', 'a', 'b'])
    })
})

describe('formatFanoutReport', () => {
    it('is empty when there are no violations', () => {
        expect(formatFanoutReport([])).toBe('')
    })

    it('includes each violation and the folder-hierarchy remediation hint', () => {
        const report = formatFanoutReport([
            {directory: 'pkg/src/foo', childCount: 17, children: ['a.ts', 'b.ts']},
        ])
        expect(report).toContain('pkg/src/foo: 17 children')
        expect(report).toContain('a.ts, b.ts')
        expect(report).toContain('folder hierarchy')
        expect(report).toContain(`${MAX_DIRECTORY_CHILDREN}-child fanout limit`)
    })

    it('pluralises the directory count', () => {
        const single = formatFanoutReport([
            {directory: 'a', childCount: MAX_DIRECTORY_CHILDREN + 1, children: []},
        ])
        const plural = formatFanoutReport([
            {directory: 'a', childCount: MAX_DIRECTORY_CHILDREN + 1, children: []},
            {directory: 'b', childCount: MAX_DIRECTORY_CHILDREN + 1, children: []},
        ])
        expect(single).toContain('1 source directory has')
        expect(plural).toContain('2 source directories have')
    })
})
