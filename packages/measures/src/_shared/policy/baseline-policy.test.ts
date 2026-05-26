import {describe, expect, it} from 'vitest'
import {baselinePolicy} from './baseline-policy.ts'

const {
    BASELINE_PREFIX,
    RATIONALE_TRAILER,
    MIN_RATIONALE_CHARS,
    classifyCommitMessage,
    classifyStagedDiff,
    formatMixedViolation,
    formatRationaleViolation,
    isBaselinePath,
} = baselinePolicy

describe('classifyStagedDiff', () => {
    it('empty diff is no-baselines', () => {
        expect(classifyStagedDiff([])).toBe('no-baselines')
    })

    it('only non-baseline files is no-baselines', () => {
        expect(classifyStagedDiff([
            'packages/measures/src/foo.ts',
            'README.md',
        ])).toBe('no-baselines')
    })

    it('only baseline files is pure-bump', () => {
        expect(classifyStagedDiff([
            `${BASELINE_PREFIX}subgraph/boundary-width.json`,
            `${BASELINE_PREFIX}subgraph/cycles.json`,
        ])).toBe('pure-bump')
    })

    it('baselines plus other files is mixed', () => {
        expect(classifyStagedDiff([
            `${BASELINE_PREFIX}subgraph/boundary-width.json`,
            'packages/measures/src/foo.ts',
        ])).toBe('mixed')
    })

    it('does not classify the budgets/ README or audit log as baselines', () => {
        expect(classifyStagedDiff([
            'packages/measures/budgets/README.md',
            'packages/measures/budgets/BASELINE_BUMP_LOG.md',
        ])).toBe('no-baselines')
    })

    it('isBaselinePath only matches files under the configured subgraph prefix', () => {
        expect(isBaselinePath('packages/measures/budgets/subgraph/cycles.json')).toBe(true)
        expect(isBaselinePath('packages/measures/budgets/BASELINE_BUMP_LOG.md')).toBe(false)
        expect(isBaselinePath('packages/measures/src/foo.ts')).toBe(false)
    })
})

describe('classifyCommitMessage', () => {
    const longReason = 'deliberate tier restructure refresh'

    it('returns missing-rationale when the trailer is absent', () => {
        expect(classifyCommitMessage('chore: bump baselines')).toBe('missing-rationale')
    })

    it('returns missing-rationale when the trailer appears mid-line, not as a trailer', () => {
        // We only accept the trailer at the start of a line.
        const msg = `chore: bump baselines mentioning ${RATIONALE_TRAILER} inline only`
        expect(classifyCommitMessage(msg)).toBe('missing-rationale')
    })

    it('returns rationale-too-short when the trailer value is below the threshold', () => {
        const msg = `chore: bump\n\n${RATIONALE_TRAILER} too short`
        expect(classifyCommitMessage(msg)).toBe('rationale-too-short')
    })

    it('returns rationale-too-short when the trailer value is empty', () => {
        const msg = `chore: bump\n\n${RATIONALE_TRAILER}`
        expect(classifyCommitMessage(msg)).toBe('rationale-too-short')
    })

    it('returns ok when the trailer value meets the threshold', () => {
        const msg = `chore: bump\n\n${RATIONALE_TRAILER} ${longReason}`
        expect(classifyCommitMessage(msg)).toBe('ok')
    })

    it('tolerates trailing whitespace on the trailer line', () => {
        const msg = `chore: bump\n\n${RATIONALE_TRAILER} ${longReason}   `
        expect(classifyCommitMessage(msg)).toBe('ok')
    })

    it('finds the trailer even when other trailers precede it', () => {
        const msg = [
            'chore: bump baselines',
            '',
            'Co-Authored-By: somebody <x@y>',
            `${RATIONALE_TRAILER} ${longReason}`,
        ].join('\n')
        expect(classifyCommitMessage(msg)).toBe('ok')
    })
})

describe('formatters', () => {
    it('formatMixedViolation lists both file sets', () => {
        const out = formatMixedViolation(
            [`${BASELINE_PREFIX}subgraph/cycles.json`],
            ['packages/measures/src/foo.ts'],
        )
        expect(out).toContain('cycles.json')
        expect(out).toContain('packages/measures/src/foo.ts')
        expect(out).toContain('OWN commit')
    })

    it('formatRationaleViolation mentions the trailer name and minimum length', () => {
        const missing = formatRationaleViolation('missing-rationale')
        expect(missing).toContain(RATIONALE_TRAILER)
        expect(missing).toContain(String(MIN_RATIONALE_CHARS))

        const tooShort = formatRationaleViolation('rationale-too-short')
        expect(tooShort).toContain(RATIONALE_TRAILER)
        expect(tooShort).toContain(String(MIN_RATIONALE_CHARS))
    })
})
