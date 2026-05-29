// Tier-0 post-edit measure: name-uniqueness.
//
// Conforms to the per-edit-hook contract `checkFile({filePath, content, env})
// → {message, severity?} | null`. The check itself is the deep function
// `checkFileForNameCollisions` in _shared/name-uniqueness; this file
// only wires the impure git capabilities from `env` (Reader-env pattern)
// into that call and formats the resulting violations for the runner.
//
// Warn-mode escalation (per design.md Decision G): the measure ships in
// warn-only for the first 7 days post-merge (returns a warning result that
// the runner prints without blocking). On WARN_MODE_UNTIL we flip the
// constant to false and start exit-2-blocking.

import {checkFileForNameCollisions} from '../../_shared/name-uniqueness/check-file.ts'

type NameUniquenessViolation = Awaited<ReturnType<typeof checkFileForNameCollisions>>[number]

// Flip to false on or after WARN_MODE_UNTIL to escalate from warn to block.
// First merged: 2026-05-26; escalate: 2026-06-02.
const WARN_MODE = true
const WARN_MODE_UNTIL = '2026-06-02'

const SOURCE_EXT_PATTERN = /\.(ts|tsx|js|jsx|mjs|cjs)$/

// Narrow Reader-env: only the impure capabilities this measure needs.
// Structurally compatible with the runner's full PerEditEnv.
type Env = {
    readonly gitHeadSha: () => string | null
    readonly gitFileAtHead: (absOrRelPath: string) => string | null
}

function formatViolation(violation: NameUniquenessViolation): string {
    const sample = violation.collidingMembers.slice(0, 6).map(m => `    • ${m.name}  ${m.filePath}`)
    const overflow = violation.collidingMembers.length > 6
        ? `\n    … +${violation.collidingMembers.length - 6} more`
        : ''
    return [
        `  ✗ ${violation.declaration.name}  (${violation.declaration.kind})`,
        `    significant tokens: [${violation.significantTokens.join(', ')}]`,
        `    collides with:`,
        sample.join('\n') + overflow,
        `    Fix: extend the name with a distinguishing domain token that does not appear in any of the colliding names.`,
    ].join('\n')
}

function formatBlockMessage(filePath: string, violations: readonly NameUniquenessViolation[]): string {
    const bar = '\x1b[0;31m' + '═'.repeat(60) + '\x1b[0m'
    const title = WARN_MODE
        ? `\x1b[0;33m⚠ NAME-UNIQUENESS WARNING (warn-mode until ${WARN_MODE_UNTIL}): ${filePath}\x1b[0m`
        : `\x1b[0;31m❌ NAME-UNIQUENESS VIOLATION: ${filePath}\x1b[0m`
    const body = violations.map(formatViolation).join('\n\n')
    const rationale = [
        '',
        '\x1b[0;33mGrep-friendly names are distinct names. A declaration whose significant\x1b[0m',
        '\x1b[0;33mtokens collide with multiple other declarations forces grep consumers\x1b[0m',
        '\x1b[0;33mto read many wrong matches. Extend the name with a domain token.\x1b[0m',
        '',
    ].join('\n')
    return ['', bar, title, bar, body, rationale, ''].join('\n')
}

export async function checkFile(args: {
    readonly filePath: string
    readonly content: string
    readonly env: Env
}): Promise<{readonly message: string; readonly severity?: 'block' | 'warn'} | null> {
    if (!SOURCE_EXT_PATTERN.test(args.filePath)) return null
    const violations = await checkFileForNameCollisions({
        filePath: args.filePath,
        content: args.content,
        previousContent: args.env.gitFileAtHead(args.filePath),
        cacheKey: args.env.gitHeadSha(),
    })
    if (violations.length === 0) return null

    const message = formatBlockMessage(args.filePath, violations)
    if (WARN_MODE) return {message, severity: 'warn'}
    return {message}
}
