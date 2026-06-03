#!/usr/bin/env node
// Impure edge: refuses commits that change too much agent-prompt text at once.
// Agent prompts are high-leverage instructions, so reviewers should see them
// in small, focused commits.

import {execFile} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {promisify} from 'node:util'

const execFileAsync = promisify(execFile)

export const AGENT_PROMPT_DIFF_LIMIT = 3

const PROMPT_PATH_PATTERN = /^packages\/systems\/voicetree-cli\/prompts\/AGENT_PROMPT_[^/]+\.md$/

type ChangeBlock = {
    readonly additions: number
    readonly deletions: number
}

export type AgentPromptDiffReport = {
    readonly changedLines: number
    readonly limit: number
    readonly files: readonly string[]
}

export function countAgentPromptChangedLines(diff: string): AgentPromptDiffReport {
    const files = new Set<string>()
    let inPromptFile = false
    let currentBlock: ChangeBlock = {additions: 0, deletions: 0}
    let changedLines = 0

    const flushBlock = (): void => {
        if (currentBlock.additions === 0 && currentBlock.deletions === 0) return
        changedLines += Math.max(currentBlock.additions, currentBlock.deletions)
        currentBlock = {additions: 0, deletions: 0}
    }

    for (const line of diff.split('\n')) {
        if (line.startsWith('diff --git ')) {
            flushBlock()
            inPromptFile = false
            continue
        }
        if (line.startsWith('+++ ')) {
            flushBlock()
            const currentFile = normalizeDiffPath(line.slice('+++ '.length))
            inPromptFile = currentFile !== null && PROMPT_PATH_PATTERN.test(currentFile)
            if (inPromptFile && currentFile !== null) files.add(currentFile)
            continue
        }
        if (!inPromptFile) continue
        if (line.startsWith('@@')) {
            flushBlock()
            continue
        }
        if (line.startsWith('+') && !line.startsWith('+++')) {
            currentBlock = {...currentBlock, additions: currentBlock.additions + 1}
            continue
        }
        if (line.startsWith('-') && !line.startsWith('---')) {
            currentBlock = {...currentBlock, deletions: currentBlock.deletions + 1}
            continue
        }
        flushBlock()
    }

    flushBlock()
    return {changedLines, limit: AGENT_PROMPT_DIFF_LIMIT, files: Array.from(files).sort()}
}

export function formatAgentPromptDiffFailure(report: AgentPromptDiffReport): string {
    const fileList = report.files.length === 0
        ? 'AGENT_PROMPT_*.md'
        : report.files.join(', ')
    return [
        `agent prompt diff size: ${report.changedLines} changed lines exceeds limit ${report.limit}`,
        `Files: ${fileList}`,
        'Split sensitive agent-prompt edits into smaller commits.',
    ].join('\n')
}

async function stagedDiff(): Promise<string> {
    const {stdout} = await execFileAsync(
        'git',
        ['diff', '--cached', '--unified=0', '--', 'packages/systems/voicetree-cli/prompts/AGENT_PROMPT_*.md'],
        {maxBuffer: 10 * 1024 * 1024},
    )
    return stdout
}

function normalizeDiffPath(raw: string): string | null {
    if (raw === '/dev/null') return null
    return raw.replace(/^[ab]\//, '')
}

async function main(): Promise<void> {
    const report = countAgentPromptChangedLines(await stagedDiff())
    if (report.changedLines <= report.limit) {
        process.exit(0)
    }
    process.stderr.write(`${formatAgentPromptDiffFailure(report)}\n`)
    process.exit(1)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    void main()
}
