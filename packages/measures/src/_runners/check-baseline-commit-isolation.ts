#!/usr/bin/env node
// Impure edge: refuses any commit that mixes packages/measures/budgets/
// files with non-baseline files. Invoked by capture-ci-checks (tier-0)
// during the pre-commit hook. Pure classification lives in
// _shared/policy/baseline-policy.ts.

import {execFileSync} from 'node:child_process'
import {baselinePolicy} from '../_shared/policy/baseline-policy.ts'

function loadStagedPaths(): string[] {
    const raw = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
        encoding: 'utf8',
    })
    return raw.split('\n').map(s => s.trim()).filter(s => s.length > 0)
}

function main(): void {
    const paths = loadStagedPaths()
    const classification = baselinePolicy.classifyStagedDiff(paths)
    if (classification !== 'mixed') {
        process.exit(0)
    }
    const baselines = paths.filter(baselinePolicy.isBaselinePath)
    const others = paths.filter(p => !baselinePolicy.isBaselinePath(p))
    process.stderr.write(baselinePolicy.formatMixedViolation(baselines, others))
    process.exit(1)
}

main()
