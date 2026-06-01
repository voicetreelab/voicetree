import {readFile} from 'node:fs/promises'
import {basename, dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'
import {listGitTrackedFiles} from '../../_shared/discovery/git-tracked-files'
import {recordHealthMetric} from '../../_shared/writers/report-writer'
import {readBudgetSync} from '../../_shared/budgets/read-budget.ts'

const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(TEST_DIR, '../../../../..')
const {limitExclusive: README_LINE_LIMIT_EXCLUSIVE} = readBudgetSync<{limitExclusive: number}>('shape/readme-line-budget.json')
const README_LINE_BUDGET = README_LINE_LIMIT_EXCLUSIVE - 1

type ReadmeLineCount = {
    readonly file: string
    readonly lineCount: number
}

function isReadmeFileName(name: string): boolean {
    return name.toLowerCase() === 'readme.md'
}

function countLines(text: string): number {
    if (text.length === 0) return 0
    return text.endsWith('\n')
        ? text.slice(0, -1).split(/\r\n|\n|\r/).length
        : text.split(/\r\n|\n|\r/).length
}

async function readmeLineCounts(repoRoot: string): Promise<ReadmeLineCount[]> {
    const readmes = listGitTrackedFiles(repoRoot).filter(path => isReadmeFileName(basename(path)))
    const counted = await Promise.all(readmes.map(async file => ({
        file,
        lineCount: countLines(await readFile(join(repoRoot, file), 'utf8')),
    })))
    return counted.sort((a, b) => a.file.localeCompare(b.file))
}

function formatReadmeLineViolation(violation: ReadmeLineCount): string {
    return `${violation.file}: ${violation.lineCount} lines`
}

describe('README line budget', () => {
    it('keeps every tracked README shorter than the line limit', async () => {
        const readmes = await readmeLineCounts(REPO_ROOT)
        const violations = readmes
            .filter(readme => readme.lineCount >= README_LINE_LIMIT_EXCLUSIVE)
            .sort((a, b) => b.lineCount - a.lineCount || a.file.localeCompare(b.file))
        const maxLineCount = readmes.reduce((max, readme) => Math.max(max, readme.lineCount), 0)

        await recordHealthMetric({
            metricId: 'readme-line-budget',
            metricName: 'README Line Budget',
            description: 'Largest tracked README line count in the repository.',
            category: 'Structure',
            current: maxLineCount,
            budget: README_LINE_BUDGET,
            comparison: 'lte',
            unit: 'lines',
            details: {
                limitExclusive: README_LINE_LIMIT_EXCLUSIVE,
                readmeCount: readmes.length,
                violations,
                largestReadmes: readmes.slice().sort((a, b) => b.lineCount - a.lineCount).slice(0, 20),
            },
        })

        expect(
            violations.map(formatReadmeLineViolation).join('\n'),
        ).toBe('')
    })
})
