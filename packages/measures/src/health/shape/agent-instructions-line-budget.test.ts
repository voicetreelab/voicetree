import {readFile, readdir} from 'node:fs/promises'
import {dirname, join, relative, resolve, sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'
import {recordHealthMetric} from '../../_shared/report-writer'

const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(TEST_DIR, '../../../../..')
const AGENT_INSTRUCTIONS_LINE_LIMIT_EXCLUSIVE = 50
const AGENT_INSTRUCTIONS_LINE_BUDGET = AGENT_INSTRUCTIONS_LINE_LIMIT_EXCLUSIVE - 1

const EXCLUDED_DIRECTORY_NAMES: ReadonlySet<string> = new Set([
    '.git',
    '.worktrees',
    'brain',
    'node_modules',
])

const AGENT_INSTRUCTIONS_FILE_NAMES: ReadonlySet<string> = new Set([
    'agents.md',
    'claude.md',
])

type AgentInstructionsLineCount = {
    readonly file: string
    readonly lineCount: number
}

function isExcludedDirectoryName(name: string): boolean {
    return EXCLUDED_DIRECTORY_NAMES.has(name)
}

function isAgentInstructionsFileName(name: string): boolean {
    return AGENT_INSTRUCTIONS_FILE_NAMES.has(name.toLowerCase())
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

async function scanAgentInstructionsLineCounts(root: string): Promise<AgentInstructionsLineCount[]> {
    const entries = await readdir(root, {withFileTypes: true})
    const nested = await Promise.all(entries.map(async entry => {
        const absolutePath = join(root, entry.name)

        if (entry.isDirectory()) {
            if (isExcludedDirectoryName(entry.name)) return []
            return scanAgentInstructionsLineCounts(absolutePath)
        }

        if (!entry.isFile() || !isAgentInstructionsFileName(entry.name)) return []

        const text = await readFile(absolutePath, 'utf8')
        return [{
            file: normalizePath(relative(REPO_ROOT, absolutePath)),
            lineCount: countLines(text),
        }]
    }))

    return nested.flat().sort((a, b) => a.file.localeCompare(b.file))
}

function formatAgentInstructionsLineViolation(violation: AgentInstructionsLineCount): string {
    return `${violation.file}: ${violation.lineCount} lines`
}

describe('agent instructions line budget', () => {
    it('keeps every CLAUDE.md and AGENTS.md shorter than the line limit', async () => {
        const matches = await scanAgentInstructionsLineCounts(REPO_ROOT)
        const violations = matches
            .filter(match => match.lineCount >= AGENT_INSTRUCTIONS_LINE_LIMIT_EXCLUSIVE)
            .sort((a, b) => b.lineCount - a.lineCount || a.file.localeCompare(b.file))
        const maxLineCount = matches.reduce((max, match) => Math.max(max, match.lineCount), 0)

        await recordHealthMetric({
            metricId: 'agent-instructions-line-budget',
            metricName: 'Agent Instructions Line Budget',
            description: 'Largest CLAUDE.md/AGENTS.md line count in the repository.',
            category: 'Structure',
            current: maxLineCount,
            budget: AGENT_INSTRUCTIONS_LINE_BUDGET,
            comparison: 'lte',
            unit: 'lines',
            details: {
                limitExclusive: AGENT_INSTRUCTIONS_LINE_LIMIT_EXCLUSIVE,
                fileCount: matches.length,
                violations,
            },
        })

        expect(
            violations.map(formatAgentInstructionsLineViolation).join('\n'),
        ).toBe('')
    })
})
