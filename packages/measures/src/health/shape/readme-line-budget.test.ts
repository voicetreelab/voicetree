import {readFile, readdir} from 'node:fs/promises'
import {dirname, join, relative, resolve, sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'
import {recordHealthMetric} from '../../_shared/report-writer'

const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(TEST_DIR, '../../../../..')
const README_LINE_LIMIT_EXCLUSIVE = 150
const README_LINE_BUDGET = README_LINE_LIMIT_EXCLUSIVE - 1

const EXCLUDED_DIRECTORY_NAMES: ReadonlySet<string> = new Set([
    '.git',
    '.worktrees',
    'brain',
    'node_modules',
])

type ReadmeLineCount = {
    readonly file: string
    readonly lineCount: number
}

function isExcludedDirectoryName(name: string): boolean {
    return EXCLUDED_DIRECTORY_NAMES.has(name)
}

function isReadmeFileName(name: string): boolean {
    return name.toLowerCase() === 'readme.md'
}

function normalizePath(path: string): string {
    return path.split(sep).join('/')
}

function countLines(text: string): number {
    if (text.length === 0) return 0
    return text.endsWith('\n')
        ? text.slice(0, -1).split(/\r\n|\n|\r/).length
        : text.split(/\r\n|\n|\r/).length
}

async function scanReadmeLineCounts(root: string): Promise<ReadmeLineCount[]> {
    const entries = await readdir(root, {withFileTypes: true})
    const nested = await Promise.all(entries.map(async entry => {
        const absolutePath = join(root, entry.name)

        if (entry.isDirectory()) {
            if (isExcludedDirectoryName(entry.name)) return []
            return scanReadmeLineCounts(absolutePath)
        }

        if (!entry.isFile() || !isReadmeFileName(entry.name)) return []

        const text = await readFile(absolutePath, 'utf8')
        return [{
            file: normalizePath(relative(REPO_ROOT, absolutePath)),
            lineCount: countLines(text),
        }]
    }))

    return nested.flat().sort((a, b) => a.file.localeCompare(b.file))
}

function formatReadmeLineViolation(violation: ReadmeLineCount): string {
    return `${violation.file}: ${violation.lineCount} lines`
}

describe('README line budget', () => {
    it('keeps every README shorter than the line limit', async () => {
        const readmes = await scanReadmeLineCounts(REPO_ROOT)
        const violations = readmes
            .filter(readme => readme.lineCount >= README_LINE_LIMIT_EXCLUSIVE)
            .sort((a, b) => b.lineCount - a.lineCount || a.file.localeCompare(b.file))
        const maxLineCount = readmes.reduce((max, readme) => Math.max(max, readme.lineCount), 0)

        await recordHealthMetric({
            metricId: 'readme-line-budget',
            metricName: 'README Line Budget',
            description: 'Largest README line count in the repository.',
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
                excludedDirectoryNames: [...EXCLUDED_DIRECTORY_NAMES],
            },
        })

        expect(
            violations.map(formatReadmeLineViolation).join('\n'),
        ).toBe('')
    })
})
