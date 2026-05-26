#!/usr/bin/env node
// Pre-commit runner edge for the tier-0 name-uniqueness gate. Reads the
// staged diff, computes newly-introduced declarations for each
// added/modified file, runs the pure policy, and exits 1 with a clear
// stderr message on any violation.
//
// All discovery / scanning / formatting lives behind the shared deep
// functions in _shared/name-uniqueness/ so this runner stays a thin
// one-import edge (mirroring _runners/check-directory-fanout.ts).

import {execFileSync} from 'node:child_process'
import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'

import {DEFAULT_REPO_ROOT} from '../_shared/discovery/discover-packages.ts'
import {buildNameUniquenessContext} from '../_shared/name-uniqueness/build-context.ts'
import {extractScopeDeclarations} from '../_shared/name-uniqueness/extract-scope.ts'
import {findNameUniquenessViolations} from '../_shared/name-uniqueness/find-violations.ts'

type StagedFile = {readonly status: 'A' | 'M'; readonly path: string}

const SOURCE_EXT_PATTERN = /\.(ts|tsx|js|jsx|mjs|cjs)$/
const BAR = '═'.repeat(72)

function stagedFiles(): readonly StagedFile[] {
    const raw = execFileSync('git', ['diff', '--cached', '--name-status', '--diff-filter=ACM', '-z'], {
        encoding: 'utf8', cwd: DEFAULT_REPO_ROOT,
    })
    const tokens = raw.split('\0').filter(s => s.length > 0)
    const out: StagedFile[] = []
    for (let i = 0; i + 1 < tokens.length; i += 2) {
        const status = tokens[i]
        const path = tokens[i + 1]
        if (status !== 'A' && status !== 'M') continue
        if (!SOURCE_EXT_PATTERN.test(path)) continue
        out.push({status, path})
    }
    return out
}

function previousContentAtHead(repoRelativePath: string): string | null {
    try {
        return execFileSync('git', ['show', `HEAD:${repoRelativePath}`], {
            encoding: 'utf8', cwd: DEFAULT_REPO_ROOT, stdio: ['ignore', 'pipe', 'ignore'],
        })
    } catch {
        return null
    }
}

function headSha(): string | null {
    try {
        return execFileSync('git', ['rev-parse', 'HEAD'], {
            encoding: 'utf8', cwd: DEFAULT_REPO_ROOT, stdio: ['ignore', 'pipe', 'ignore'],
        }).trim()
    } catch {
        return null
    }
}

async function gatherScope(files: readonly StagedFile[]) {
    const scope = await Promise.all(files.map(async file => {
        const absPath = resolve(DEFAULT_REPO_ROOT, file.path)
        const content = await readFile(absPath, 'utf8').catch(() => null)
        if (content === null) return []
        const prev = file.status === 'A' ? null : previousContentAtHead(file.path)
        return extractScopeDeclarations({filePath: absPath, content, previousContent: prev})
    }))
    return scope.flat()
}

function formatViolation(violation: ReturnType<typeof findNameUniquenessViolations>[number]): string {
    const sample = violation.collidingMembers.slice(0, 6).map(m => `    • ${m.name}  ${m.filePath}`)
    const overflow = violation.collidingMembers.length > 6
        ? `\n    … +${violation.collidingMembers.length - 6} more`
        : ''
    return [
        `  ✗ ${violation.declaration.name}  (${violation.declaration.kind})  in ${violation.declaration.filePath}`,
        `    significant tokens: [${violation.significantTokens.join(', ')}]`,
        `    collides with:`,
        sample.join('\n') + overflow,
    ].join('\n')
}

function formatReport(violations: ReturnType<typeof findNameUniquenessViolations>): string {
    const body = violations.map(formatViolation).join('\n\n')
    const subject = violations.length === 1
        ? '1 newly-introduced name collides'
        : `${violations.length} newly-introduced names collide`
    return [
        '',
        BAR,
        `Refused: ${subject} with existing declarations on token overlap.`,
        '',
        body,
        '',
        'Grep-friendly names are distinct names. Extend each flagged name with',
        'a domain token that does not appear in any of the colliding members,',
        'or — if the collision is intentional convention — add the token to',
        'packages/measures/budgets/name-uniqueness-allowlist.json.',
        BAR,
        '',
    ].join('\n')
}

async function main(): Promise<void> {
    const files = stagedFiles()
    if (files.length === 0) {
        process.exit(0)
    }
    const scope = await gatherScope(files)
    if (scope.length === 0) {
        process.exit(0)
    }
    const context = await buildNameUniquenessContext({cacheKey: headSha()})
    const violations = findNameUniquenessViolations({
        scope,
        index: context.index,
        allowlist: context.allowlist,
        importGraph: context.importGraph,
    })
    if (violations.length === 0) {
        process.exit(0)
    }
    process.stderr.write(formatReport(violations))
    process.exit(1)
}

main().catch(err => {
    console.error(err)
    process.exit(1)
})
