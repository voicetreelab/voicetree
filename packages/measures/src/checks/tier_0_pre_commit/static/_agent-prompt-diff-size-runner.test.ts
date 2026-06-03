import {describe, expect, it} from 'vitest'

import {
    AGENT_PROMPT_DIFF_LIMIT,
    countAgentPromptChangedLines,
    formatAgentPromptDiffFailure,
} from './_agent-prompt-diff-size-runner.ts'

describe('countAgentPromptChangedLines', () => {
    it('counts a one-line replacement as one changed line', () => {
        const report = countAgentPromptChangedLines([
            'diff --git a/packages/systems/voicetree-cli/prompts/AGENT_PROMPT_CORE.md b/packages/systems/voicetree-cli/prompts/AGENT_PROMPT_CORE.md',
            '--- a/packages/systems/voicetree-cli/prompts/AGENT_PROMPT_CORE.md',
            '+++ b/packages/systems/voicetree-cli/prompts/AGENT_PROMPT_CORE.md',
            '@@ -1 +1 @@',
            '-old line',
            '+new line',
        ].join('\n'))

        expect(report.changedLines).toBe(1)
        expect(report.files).toEqual(['packages/systems/voicetree-cli/prompts/AGENT_PROMPT_CORE.md'])
    })

    it('counts separated edits independently across agent prompt files', () => {
        const report = countAgentPromptChangedLines([
            'diff --git a/packages/systems/voicetree-cli/prompts/AGENT_PROMPT_CORE.md b/packages/systems/voicetree-cli/prompts/AGENT_PROMPT_CORE.md',
            '--- a/packages/systems/voicetree-cli/prompts/AGENT_PROMPT_CORE.md',
            '+++ b/packages/systems/voicetree-cli/prompts/AGENT_PROMPT_CORE.md',
            '@@ -2,0 +3 @@',
            '+new line',
            '@@ -8 +8,0 @@',
            '-removed line',
            'diff --git a/packages/systems/voicetree-cli/prompts/AGENT_PROMPT_LIGHTWEIGHT.md b/packages/systems/voicetree-cli/prompts/AGENT_PROMPT_LIGHTWEIGHT.md',
            '--- a/packages/systems/voicetree-cli/prompts/AGENT_PROMPT_LIGHTWEIGHT.md',
            '+++ b/packages/systems/voicetree-cli/prompts/AGENT_PROMPT_LIGHTWEIGHT.md',
            '@@ -1 +1 @@',
            '-old',
            '+new',
        ].join('\n'))

        expect(report.changedLines).toBe(3)
        expect(report.limit).toBe(AGENT_PROMPT_DIFF_LIMIT)
    })

    it('ignores non-agent-prompt files', () => {
        const report = countAgentPromptChangedLines([
            'diff --git a/packages/systems/voicetree-cli/prompts/README.md b/packages/systems/voicetree-cli/prompts/README.md',
            '--- a/packages/systems/voicetree-cli/prompts/README.md',
            '+++ b/packages/systems/voicetree-cli/prompts/README.md',
            '@@ -1 +1 @@',
            '-old',
            '+new',
        ].join('\n'))

        expect(report.changedLines).toBe(0)
        expect(report.files).toEqual([])
    })
})

describe('formatAgentPromptDiffFailure', () => {
    it('tells authors to split oversized prompt edits', () => {
        const message = formatAgentPromptDiffFailure({
            changedLines: 4,
            limit: 3,
            files: ['packages/systems/voicetree-cli/prompts/AGENT_PROMPT_CORE.md'],
        })

        expect(message).toContain('4 changed lines exceeds limit 3')
        expect(message).toContain('Split sensitive agent-prompt edits into smaller commits.')
    })
})
