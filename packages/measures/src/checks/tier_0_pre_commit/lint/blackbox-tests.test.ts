import {readFile} from 'node:fs/promises'
import {readdirSync} from 'node:fs'
import {dirname, join, relative, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'

const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(TEST_DIR, '../../../../../..')
const DEFAULT_THRESHOLD = 50
const TEST_ROOTS = ['packages', 'webapp/src'] as const
const EXPECT_PATTERN = /expect[(]/
const MOCK_CALL_PATTERN = new RegExp([
    ['toHaveBeen', 'Called'].join(''),
    ['toHaveBeenNth', 'Called'].join(''),
    ['toHaveBeenLast', 'Called'].join(''),
    ['mock', '[.]', 'calls'].join(''),
    ['mock', '[.]', 'results'].join(''),
].join('|'))

type BlackboxViolation = {
    readonly relativePath: string
    readonly percent: number
    readonly mockAssertions: number
    readonly totalAssertions: number
}

function listTestFiles(root: string): string[] {
    const entries = readdirSync(root, {withFileTypes: true})
    return entries.flatMap(entry => {
        const absolutePath = join(root, entry.name)
        if (entry.isDirectory()) return listTestFiles(absolutePath)
        if (!entry.isFile() || !isTestFile(absolutePath)) return []
        return [absolutePath]
    })
}

function isTestFile(path: string): boolean {
    return path.endsWith('.test.ts') || path.endsWith('.test.tsx')
}

function countMatchingLines(text: string, pattern: RegExp): number {
    return text.split(/\r?\n/).filter(line => pattern.test(line)).length
}

async function findBlackboxViolations(threshold: number): Promise<BlackboxViolation[]> {
    const testFiles = TEST_ROOTS
        .flatMap(root => listTestFiles(join(REPO_ROOT, root)))
        .sort((a, b) => relative(REPO_ROOT, a).localeCompare(relative(REPO_ROOT, b)))

    const checks = await Promise.all(testFiles.map(async file => {
        const content = await readFile(file, 'utf8')
        const totalAssertions = countMatchingLines(content, EXPECT_PATTERN)
        if (totalAssertions === 0) return null

        const mockAssertions = countMatchingLines(content, MOCK_CALL_PATTERN)
        const percent = Math.floor(mockAssertions * 100 / totalAssertions)
        if (percent <= threshold) return null

        return {
            relativePath: relative(REPO_ROOT, file),
            percent,
            mockAssertions,
            totalAssertions,
        }
    }))

    return checks.filter((violation): violation is BlackboxViolation => violation !== null)
}

function formatViolation({percent, mockAssertions, totalAssertions, relativePath}: BlackboxViolation): string {
    return `FAIL: ${percent}% mock assertions (${mockAssertions}/${totalAssertions}) in ${relativePath}`
}

describe('blackbox test lint', () => {
    it('keeps mock-call assertions below the configured threshold', async () => {
        const violations = await findBlackboxViolations(DEFAULT_THRESHOLD)
        const details = [
            ...violations.map(formatViolation),
            violations.length > 0 ? '' : null,
            violations.length > 0
                ? `FAILED: ${violations.length} test file(s) exceed ${DEFAULT_THRESHOLD}% mock-call assertion threshold.`
                : null,
            violations.length > 0 ? 'Tests should be black-box: call the function, assert on the output.' : null,
            violations.length > 0 ? 'See CLAUDE.md for the testing philosophy.' : null,
        ].filter((line): line is string => line !== null).join('\n')

        expect(violations, details).toEqual([])
    })
})
