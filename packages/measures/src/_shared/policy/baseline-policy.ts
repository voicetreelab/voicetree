// Pure policy for baseline-bump discipline. Two classifications:
//   1. `classifyStagedDiff` — given the set of staged paths, is this commit a
//      pure baseline-bump (only files under packages/measures/budgets/), a
//      mixed commit (baselines AND other files), or just a regular commit
//      (no baselines)?
//   2. `classifyCommitMessage` — does the commit message carry a sufficient
//      `Baseline-bump-rationale:` trailer?
//
// No I/O — callers (git hooks, runners) supply the inputs.
//
// Public surface (M1: deep-narrow module): a single `baselinePolicy` value
// holds every classifier, formatter, and config constant. Callers reach for
// `baselinePolicy.classifyStagedDiff(...)` etc. Bundling the surface this
// way keeps the importing community's boundary-width score honest — the
// alternative (eight top-level exports) inflates the channel without
// adding anything callers couldn't already reach via one.

// Only files under .../budgets/subgraph/ are themselves baselines. The
// budgets/ root holds documentation (README, BASELINE_BUMP_LOG) that is
// *about* baselines without being one — those must remain freely committable.
const BASELINE_PREFIX = 'packages/measures/budgets/subgraph/'
const RATIONALE_TRAILER = 'Baseline-bump-rationale:'
const MIN_RATIONALE_CHARS = 20

type StagedDiffClassification = 'no-baselines' | 'pure-bump' | 'mixed'
type CommitMessageClassification = 'ok' | 'missing-rationale' | 'rationale-too-short'
function isBaselinePath(path: string): boolean {
    return path.startsWith(BASELINE_PREFIX)
}

function classifyStagedDiff(paths: readonly string[]): StagedDiffClassification {
    if (paths.length === 0) return 'no-baselines'
    const baselines = paths.filter(isBaselinePath)
    if (baselines.length === 0) return 'no-baselines'
    if (baselines.length === paths.length) return 'pure-bump'
    return 'mixed'
}

function extractRationale(message: string): string | null {
    // Match the trailer anywhere on its own line; tolerate trailing whitespace.
    for (const line of message.split('\n')) {
        const trimmed = line.trimEnd()
        if (!trimmed.startsWith(RATIONALE_TRAILER)) continue
        return trimmed.slice(RATIONALE_TRAILER.length).trim()
    }
    return null
}

function classifyCommitMessage(message: string): CommitMessageClassification {
    const rationale = extractRationale(message)
    if (rationale === null) return 'missing-rationale'
    if (rationale.length < MIN_RATIONALE_CHARS) return 'rationale-too-short'
    return 'ok'
}

const BAR = '━'.repeat(80)

function formatMixedViolation(baselinePaths: readonly string[], otherPaths: readonly string[]): string {
    const baselineList = baselinePaths.map(p => `    ${p}`).join('\n')
    const otherList = otherPaths.map(p => `    ${p}`).join('\n')
    return [
        '',
        BAR,
        'Refused: baseline files staged alongside non-baseline files.',
        '',
        `A baseline bump must be its OWN commit. Touching files under`,
        `  ${BASELINE_PREFIX}`,
        `in the same commit as other changes hides the bump from review.`,
        '',
        'Baseline files staged:',
        baselineList,
        '',
        'Other files staged:',
        otherList,
        '',
        'Fix: unstage one set and commit them separately.',
        BAR,
        '',
    ].join('\n')
}

function formatRationaleViolation(kind: 'missing-rationale' | 'rationale-too-short'): string {
    const reason = kind === 'missing-rationale'
        ? `No \`${RATIONALE_TRAILER}\` trailer found in the commit message.`
        : `The \`${RATIONALE_TRAILER}\` trailer is shorter than ${MIN_RATIONALE_CHARS} characters.`
    return [
        '',
        BAR,
        'Refused: baseline-bump commit is missing a written rationale.',
        '',
        reason,
        '',
        'Every baseline bump must carry a `git log`-discoverable reason. Add a',
        `trailer line of at least ${MIN_RATIONALE_CHARS} characters:`,
        '',
        `  ${RATIONALE_TRAILER} <why this bump is justified, not a reflex>`,
        '',
        'If you were tempted to bump because the gate failed, do NOT bump:',
        '  brain/workflows/engineering/architectural-complexity/fp-rearchitecting/SKILL.md',
        BAR,
        '',
    ].join('\n')
}

export const baselinePolicy = {
    baselinePrefix: BASELINE_PREFIX,
    rationaleTrailer: RATIONALE_TRAILER,
    minRationaleChars: MIN_RATIONALE_CHARS,
    isBaselinePath,
    classifyStagedDiff,
    classifyCommitMessage,
    formatMixedViolation,
    formatRationaleViolation,
} as const
