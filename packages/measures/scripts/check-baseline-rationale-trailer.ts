#!/usr/bin/env node
// Impure edge: enforces that a pure baseline-bump commit carries a
// `Baseline-bump-rationale:` trailer. Invoked from .githooks/commit-msg
// with the commit-message file path as argv[2] (git's commit-msg contract).
//
// If the commit touches non-baseline files, this check exits 0 — that
// case is owned by the tier-0 `baseline-commit-isolation` check, which
// fires inside the pre-commit hook *before* commit-msg runs.

import {execFileSync, spawnSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {baselinePolicy} from '../src/_shared/policy/baseline-policy.ts'

function loadStagedPaths(): string[] {
    const raw = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
        encoding: 'utf8',
    })
    return raw.split('\n').map(s => s.trim()).filter(s => s.length > 0)
}

function isMergeCommitInProgress(): boolean {
    const result = spawnSync('git', ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], {stdio: 'ignore'})
    return result.status === 0
}

function main(): void {
    const messagePath = process.argv[2]
    if (!messagePath) {
        process.stderr.write('check-baseline-rationale-trailer: expected commit-message file path as first arg\n')
        process.exit(2)
    }

    const stagedClassification = baselinePolicy.classifyStagedDiff(
        loadStagedPaths(),
        {isMergeCommit: isMergeCommitInProgress()},
    )
    if (stagedClassification !== 'pure-bump') {
        // Not a pure baseline bump — this hook has no opinion.
        process.exit(0)
    }

    const message = readFileSync(messagePath, 'utf8')
    const messageClassification = baselinePolicy.classifyCommitMessage(message)
    if (messageClassification === 'ok') {
        process.exit(0)
    }

    process.stderr.write(baselinePolicy.formatRationaleViolation(messageClassification))
    process.exit(1)
}

main()
