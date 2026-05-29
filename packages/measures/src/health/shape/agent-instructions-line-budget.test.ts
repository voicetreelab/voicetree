import {readFile} from 'node:fs/promises'
import {basename, dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'
import {listGitTrackedFiles} from '../../_shared/discovery/git-tracked-files'
import {recordHealthMetric} from '../../_shared/writers/report-writer'

const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(TEST_DIR, '../../../../..')
// 2026-05-28 [PR #139]: raised from 50 → 300. Commit 038a827cd intentionally
// synced ~243 lines of canonical agent guidance (core values, escalation
// rules, vt CLI quickref, etc.) into AGENTS.md / CLAUDE.md from the user's
// global template. The previous 50-line ceiling reflected an earlier era
// when the files were tool-routing stubs; the canonical content is the
// new floor. Ratchet DOWN as guidance is consolidated into linkable docs.
const AGENT_INSTRUCTIONS_LINE_LIMIT_EXCLUSIVE = 300
const AGENT_INSTRUCTIONS_LINE_BUDGET = AGENT_INSTRUCTIONS_LINE_LIMIT_EXCLUSIVE - 1

const AGENT_INSTRUCTIONS_FILE_NAMES: ReadonlySet<string> = new Set([
    'agents.md',
    'claude.md',
])

type AgentInstructionsLineCount = {
    readonly file: string
    readonly lineCount: number
}

function isAgentInstructionsFileName(name: string): boolean {
    return AGENT_INSTRUCTIONS_FILE_NAMES.has(name.toLowerCase())
}

function countLines(text: string): number {
    if (text.length === 0) return 0
    return text.endsWith('\n')
        ? text.slice(0, -1).split(/\r\n|\n|\r/).length
        : text.split(/\r\n|\n|\r/).length
}

async function agentInstructionsLineCounts(repoRoot: string): Promise<AgentInstructionsLineCount[]> {
    const matches = listGitTrackedFiles(repoRoot).filter(path => isAgentInstructionsFileName(basename(path)))
    const counted = await Promise.all(matches.map(async file => ({
        file,
        lineCount: countLines(await readFile(join(repoRoot, file), 'utf8')),
    })))
    return counted.sort((a, b) => a.file.localeCompare(b.file))
}

function formatAgentInstructionsLineViolation(violation: AgentInstructionsLineCount): string {
    return `${violation.file}: ${violation.lineCount} lines`
}

describe('agent instructions line budget', () => {
    it('keeps every tracked CLAUDE.md and AGENTS.md shorter than the line limit', async () => {
        const matches = await agentInstructionsLineCounts(REPO_ROOT)
        const violations = matches
            .filter(match => match.lineCount >= AGENT_INSTRUCTIONS_LINE_LIMIT_EXCLUSIVE)
            .sort((a, b) => b.lineCount - a.lineCount || a.file.localeCompare(b.file))
        const maxLineCount = matches.reduce((max, match) => Math.max(max, match.lineCount), 0)

        await recordHealthMetric({
            metricId: 'agent-instructions-line-budget',
            metricName: 'Agent Instructions Line Budget',
            description: 'Largest tracked CLAUDE.md/AGENTS.md line count in the repository.',
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
