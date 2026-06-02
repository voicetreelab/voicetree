// Pure per-edit measure: given a {filePath, content} pair, decide whether
// the file violates the line-count budget and (on violation) return a
// formatted message ready for stderr. I/O lives in
// _runners/per-edit-hook.ts (the runner edge); this module reads the
// budget from budgets/shape/file-size.json at init time.

import {fileSizePredicate} from '../_shared/file-size-predicate.ts'
import {readBudgetSync} from '../../_shared/budgets/read-budget.ts'

const {maxLines: FILE_SIZE_MAX_LINES} = readBudgetSync<{maxLines: number}>('shape/file-size.json')

export type PerEditViolation = {readonly message: string}

export function checkFile(args: {readonly filePath: string; readonly content: string}): PerEditViolation | null {
    if (!fileSizePredicate.isSourceFile(args.filePath)) return null
    const result = fileSizePredicate.fileSizeCheck(args.content, FILE_SIZE_MAX_LINES)
    if (result.kind === 'ok') return null
    return {message: formatViolation(args.filePath, result.actualLines, result.maxLines)}
}

function lastSegment(filePath: string): string {
    const slash = filePath.lastIndexOf('/')
    return slash === -1 ? filePath : filePath.slice(slash + 1)
}

function formatViolation(filePath: string, actualLines: number, maxLines: number): string {
    return [
        '',
        '\x1b[0;31m════════════════════════════════════════════\x1b[0m',
        `\x1b[0;31m❌ FILE TOO LARGE: ${lastSegment(filePath)}\x1b[0m`,
        `\x1b[0;31m   ${actualLines} lines — limit is ${maxLines}\x1b[0m`,
        '\x1b[0;31m════════════════════════════════════════════\x1b[0m',
        '\x1b[0;33mExtract this file into multiple files.\x1b[0m',
        '\x1b[0;33mUse functional programming philosophy to guide your extraction.\x1b[0m',
        '\x1b[0;33mPure functions are ideal; edge with side effects when necessary; avoid OOP.\x1b[0m',
        '',
    ].join('\n')
}
