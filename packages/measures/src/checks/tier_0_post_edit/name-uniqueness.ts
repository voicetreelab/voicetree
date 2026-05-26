// Tier-0 post-edit measure: name-uniqueness.
//
// Conforms to the per-edit-hook contract `checkFile({filePath, content})
// → {message} | null`. Internally:
//   1. Resolve `git show HEAD:<path>` (or null for an untracked file).
//   2. Compute the file's introduced declarations via extract-scope.
//   3. Build (cached) name-uniqueness context, cache key = HEAD sha.
//   4. Run `findNameUniquenessViolations`. Format any violations as a
//      single multi-line message; return null when there are none.
//
// Warn-mode escalation (per design.md Decision G): the measure ships in
// warn-only for the first 7 days post-merge (returns null but still
// prints the formatted message to stderr so agents see it). On
// WARN_MODE_UNTIL we flip the constant to false and start exit-2-blocking.

import {execFileSync} from 'node:child_process'

import {buildNameUniquenessContext} from '../../_shared/name-uniqueness/build-context.ts'
import {extractScopeDeclarations} from '../../_shared/name-uniqueness/extract-scope.ts'
import {findNameUniquenessViolations} from '../../_shared/name-uniqueness/find-violations.ts'

// Flip to false on or after WARN_MODE_UNTIL to escalate from warn to block.
// First merged: 2026-05-26; escalate: 2026-06-02.
const WARN_MODE = true
const WARN_MODE_UNTIL = '2026-06-02'

const SOURCE_EXT_PATTERN = /\.(ts|tsx|js|jsx|mjs|cjs)$/

type CachedContext = Awaited<ReturnType<typeof buildNameUniquenessContext>>
let cachedHead: string | null = null
let cachedContextPromise: Promise<CachedContext> | null = null

function currentHeadSha(): string | null {
    try {
        return execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim()
    } catch {
        return null
    }
}

function previousContentAtHead(filePath: string): string | null {
    try {
        const relPath = execFileSync('git', ['ls-files', '--full-name', '--', filePath], {
            encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
        }).trim()
        if (relPath.length === 0) return null
        return execFileSync('git', ['show', `HEAD:${relPath}`], {
            encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
        })
    } catch {
        return null
    }
}

async function loadContextMemoised(): Promise<CachedContext> {
    const head = currentHeadSha()
    if (head !== cachedHead || cachedContextPromise === null) {
        cachedHead = head
        cachedContextPromise = buildNameUniquenessContext({cacheKey: head})
    }
    return cachedContextPromise
}

function formatViolation(violation: ReturnType<typeof findNameUniquenessViolations>[number]): string {
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

function formatBlockMessage(filePath: string, violations: ReturnType<typeof findNameUniquenessViolations>): string {
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
}): Promise<{readonly message: string} | null> {
    if (!SOURCE_EXT_PATTERN.test(args.filePath)) return null
    const previousContent = previousContentAtHead(args.filePath)
    const scope = extractScopeDeclarations({
        filePath: args.filePath,
        content: args.content,
        previousContent,
    })
    if (scope.length === 0) return null

    const context = await loadContextMemoised()
    const violations = findNameUniquenessViolations({
        scope,
        index: context.index,
        allowlist: context.allowlist,
        importGraph: context.importGraph,
    })
    if (violations.length === 0) return null

    const message = formatBlockMessage(args.filePath, violations)
    if (WARN_MODE) {
        process.stderr.write(message + '\n')
        return null
    }
    return {message}
}
