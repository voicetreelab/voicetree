#!/usr/bin/env node
import {DEFAULT_REPO_ROOT} from '../_shared/discovery/discover-packages.ts'
import {checkProjectVocabulary} from '../_shared/vocabulary/project-vocabulary.ts'

async function main(): Promise<void> {
    const report = await checkProjectVocabulary(DEFAULT_REPO_ROOT)
    if (report.violations.length === 0) process.exit(0)
    process.stderr.write(report.report)
    process.exit(1)
}

main()
