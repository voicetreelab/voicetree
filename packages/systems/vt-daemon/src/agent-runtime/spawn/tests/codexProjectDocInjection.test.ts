import {describe, it, expect} from 'vitest'

import {
    detectAgentCli,
    injectCodexProjectDocDisableFlag,
} from '../injection/codexProjectDocInjection'

describe('detectAgentCli', () => {
    it('recognises bare claude command', () => {
        expect(detectAgentCli('claude --dangerously-skip-permissions "$AGENT_PROMPT"')).toBe('claude')
    })

    it('recognises claude after leading env-var assignments', () => {
        expect(detectAgentCli('CLAUDE_CODE_NO_FLICKER=1 claude --dangerously-skip-permissions "$AGENT_PROMPT"'))
            .toBe('claude')
    })

    it('recognises codex', () => {
        expect(detectAgentCli('codex "$AGENT_PROMPT"')).toBe('codex')
    })

    it('does not confuse claude-code or --claude with the claude binary', () => {
        expect(detectAgentCli('claude-code "$AGENT_PROMPT"')).toBe('other')
        expect(detectAgentCli('node --claude "$AGENT_PROMPT"')).toBe('other')
    })

    it('returns other for unsupported agents', () => {
        expect(detectAgentCli('gemini -i "$AGENT_PROMPT"')).toBe('other')
        expect(detectAgentCli('opencode --prompt "$AGENT_PROMPT"')).toBe('other')
    })

    it('returns other for empty / whitespace command', () => {
        expect(detectAgentCli('')).toBe('other')
        expect(detectAgentCli('   ')).toBe('other')
    })
})

describe('injectCodexProjectDocDisableFlag', () => {
    it('inserts the Codex project-doc disable flag right after the codex token', () => {
        const result = injectCodexProjectDocDisableFlag('codex "$AGENT_PROMPT" --yolo')
        expect(result).toBe('codex -c project_doc_max_bytes=0 "$AGENT_PROMPT" --yolo')
    })

    it('preserves leading env-var assignments', () => {
        const result = injectCodexProjectDocDisableFlag('NO_COLOR=1 codex "$AGENT_PROMPT"')
        expect(result).toBe('NO_COLOR=1 codex -c project_doc_max_bytes=0 "$AGENT_PROMPT"')
    })

    it('is idempotent when project_doc_max_bytes is already configured', () => {
        const cmd = 'codex -c project_doc_max_bytes=0 "$AGENT_PROMPT"'
        expect(injectCodexProjectDocDisableFlag(cmd)).toBe(cmd)
    })

    it('leaves non-codex commands unchanged', () => {
        const claude = 'claude --dangerously-skip-permissions "$AGENT_PROMPT"'
        expect(injectCodexProjectDocDisableFlag(claude)).toBe(claude)
    })
})
