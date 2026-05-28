#!/usr/bin/env node
// Impure edge: refuses any commit where a source directory has exceeded the
// directory-fanout limit. Invoked by capture-ci-checks (tier-0 pre-commit).
// All discovery / scanning / formatting lives behind the deep-narrow
// `checkDirectoryFanouts` function so this runner stays a one-import shell.
//
// Scope: the whole-repo scan rather than a staged-files diff is intentional —
// a directory becomes "wrong" the moment it crosses the limit regardless
// of who added the offending file in this commit. A diff-scoped check would
// let earlier in-flight work commit and shift the blame onto an innocent
// later commit; the wider scan errors at the first attempt instead.

import {checkDirectoryFanouts} from '../_shared/shape/directory-fanout.ts'

async function main(): Promise<void> {
    const report = await checkDirectoryFanouts()
    if (report.violations.length === 0) {
        process.exit(0)
    }
    process.stderr.write(report.report)
    process.exit(1)
}

main()
