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

// ALL files under budgets/ are baselines, EXCEPT .md files (README,
// HOW_TO_BUMP_BASELINES.md, BASELINE_BUMP_LOG.md). Markdown files are
// documentation *about* budgets — freely committable alongside any change.
// Every other file under budgets/ (JSON data, TypeScript data modules) is a
// budget value and must be committed in isolation with a written rationale.
const BASELINE_PREFIX = 'packages/measures/budgets/'
const RATIONALE_TRAILER = 'Baseline-bump-rationale:'
const MIN_RATIONALE_CHARS = 20

type StagedDiffClassification = 'no-baselines' | 'pure-bump' | 'mixed'
type CommitMessageClassification = 'ok' | 'missing-rationale' | 'rationale-too-short'

// Context the impure caller injects so the pure classifier can short-circuit
// for cases where the discipline doesn't apply.
type StagedDiffContext = {
    // Merge commits exempt: their baseline bumps were already reviewed on
    // the source branch (with their own rationale and isolation gates).
    // Re-asserting isolation on the merge would refuse every cross-branch
    // integration that touches both code and baselines.
    readonly isMergeCommit: boolean
}

function isBaselinePath(path: string): boolean {
    return path.startsWith(BASELINE_PREFIX) && !path.endsWith('.md')
}

function classifyStagedDiff(
    paths: readonly string[],
    ctx: StagedDiffContext,
): StagedDiffClassification {
    if (ctx.isMergeCommit) return 'no-baselines'
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
        'Refused: budget/baseline files staged alongside non-baseline files.',
        '',
        `A budget bump must be its OWN commit. Touching files under`,
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
        'Refused: budget/baseline-bump commit is missing a written rationale.',
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
