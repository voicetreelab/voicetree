import {describe, expect, it} from 'vitest'
import {baselinePolicy} from './baseline-policy.ts'

describe('classifyStagedDiff', () => {
    it('empty diff is no-baselines', () => {
        expect(baselinePolicy.classifyStagedDiff([], {isMergeCommit: false})).toBe('no-baselines')
    })

    it('only non-baseline files is no-baselines', () => {
        expect(baselinePolicy.classifyStagedDiff([
            'packages/measures/src/foo.ts',
            'README.md',
        ], {isMergeCommit: false})).toBe('no-baselines')
    })

    it('only baseline files is pure-bump', () => {
        expect(baselinePolicy.classifyStagedDiff([
            `${baselinePolicy.baselinePrefix}subgraph/boundary-width.json`,
            `${baselinePolicy.baselinePrefix}subgraph/cycles.json`,
        ], {isMergeCommit: false})).toBe('pure-bump')
    })

    it('baselines plus other files is mixed', () => {
        expect(baselinePolicy.classifyStagedDiff([
            `${baselinePolicy.baselinePrefix}subgraph/boundary-width.json`,
            'packages/measures/src/foo.ts',
        ], {isMergeCommit: false})).toBe('mixed')
    })

    it('does not classify the budgets/ README or audit log as baselines', () => {
        expect(baselinePolicy.classifyStagedDiff([
            'packages/measures/budgets/README.md',
            'packages/measures/budgets/BASELINE_BUMP_LOG.md',
        ], {isMergeCommit: false})).toBe('no-baselines')
    })

    it('merge commits are exempt — baselines from the source branch were already reviewed', () => {
        expect(baselinePolicy.classifyStagedDiff([
            `${baselinePolicy.baselinePrefix}subgraph/boundary-width.json`,
            'packages/measures/src/foo.ts',
        ], {isMergeCommit: true})).toBe('no-baselines')
    })

    it('merge-commit exemption applies even for what would otherwise be a pure-bump', () => {
        expect(baselinePolicy.classifyStagedDiff([
            `${baselinePolicy.baselinePrefix}subgraph/boundary-width.json`,
        ], {isMergeCommit: true})).toBe('no-baselines')
    })

    it('isBaselinePath matches any non-markdown file under budgets/', () => {
        expect(baselinePolicy.isBaselinePath('packages/measures/budgets/subgraph/cycles.json')).toBe(true)
        expect(baselinePolicy.isBaselinePath('packages/measures/budgets/shape/readme-line-budget.json')).toBe(true)
        expect(baselinePolicy.isBaselinePath('packages/measures/budgets/coupling/cross-package-value-symbol-budgets.ts')).toBe(true)
        expect(baselinePolicy.isBaselinePath('packages/measures/budgets/BASELINE_BUMP_LOG.md')).toBe(false)
        expect(baselinePolicy.isBaselinePath('packages/measures/budgets/HOW_TO_BUMP_BASELINES.md')).toBe(false)
        expect(baselinePolicy.isBaselinePath('packages/measures/src/foo.ts')).toBe(false)
    })

    it('classifies new-area budget files (shape, coupling, etc.) as baselines', () => {
        expect(baselinePolicy.classifyStagedDiff([
            'packages/measures/budgets/shape/readme-line-budget.json',
            'packages/measures/budgets/complexity/runtime-fan-in.json',
        ], {isMergeCommit: false})).toBe('pure-bump')
    })

    it('rejects mixed commit containing a new-area budget file and a source file', () => {
        expect(baselinePolicy.classifyStagedDiff([
            'packages/measures/budgets/duplication/semantic-duplication.json',
            'packages/measures/src/health/duplication/semantic-duplication.test.ts',
        ], {isMergeCommit: false})).toBe('mixed')
    })
})

describe('classifyCommitMessage', () => {
    const longReason = 'deliberate tier restructure refresh'

    it('returns missing-rationale when the trailer is absent', () => {
        expect(baselinePolicy.classifyCommitMessage('chore: bump baselines')).toBe('missing-rationale')
    })

    it('returns missing-rationale when the trailer appears mid-line, not as a trailer', () => {
        // We only accept the trailer at the start of a line.
        const msg = `chore: bump baselines mentioning ${baselinePolicy.rationaleTrailer} inline only`
        expect(baselinePolicy.classifyCommitMessage(msg)).toBe('missing-rationale')
    })

    it('returns rationale-too-short when the trailer value is below the threshold', () => {
        const msg = `chore: bump\n\n${baselinePolicy.rationaleTrailer} too short`
        expect(baselinePolicy.classifyCommitMessage(msg)).toBe('rationale-too-short')
    })

    it('returns rationale-too-short when the trailer value is empty', () => {
        const msg = `chore: bump\n\n${baselinePolicy.rationaleTrailer}`
        expect(baselinePolicy.classifyCommitMessage(msg)).toBe('rationale-too-short')
    })

    it('returns ok when the trailer value meets the threshold', () => {
        const msg = `chore: bump\n\n${baselinePolicy.rationaleTrailer} ${longReason}`
        expect(baselinePolicy.classifyCommitMessage(msg)).toBe('ok')
    })

    it('tolerates trailing whitespace on the trailer line', () => {
        const msg = `chore: bump\n\n${baselinePolicy.rationaleTrailer} ${longReason}   `
        expect(baselinePolicy.classifyCommitMessage(msg)).toBe('ok')
    })

    it('finds the trailer even when other trailers precede it', () => {
        const msg = [
            'chore: bump baselines',
            '',
            'Co-Authored-By: somebody <x@y>',
            `${baselinePolicy.rationaleTrailer} ${longReason}`,
        ].join('\n')
        expect(baselinePolicy.classifyCommitMessage(msg)).toBe('ok')
    })
})

describe('formatters', () => {
    it('formatMixedViolation lists both file sets', () => {
        const out = baselinePolicy.formatMixedViolation(
            [`${baselinePolicy.baselinePrefix}subgraph/cycles.json`],
            ['packages/measures/src/foo.ts'],
        )
        expect(out).toContain('cycles.json')
        expect(out).toContain('packages/measures/src/foo.ts')
        expect(out).toContain('OWN commit')
    })

    it('formatRationaleViolation mentions the trailer name and minimum length', () => {
        const missing = baselinePolicy.formatRationaleViolation('missing-rationale')
        expect(missing).toContain(baselinePolicy.rationaleTrailer)
        expect(missing).toContain(String(baselinePolicy.minRationaleChars))

        const tooShort = baselinePolicy.formatRationaleViolation('rationale-too-short')
        expect(tooShort).toContain(baselinePolicy.rationaleTrailer)
        expect(tooShort).toContain(String(baselinePolicy.minRationaleChars))
    })
})
