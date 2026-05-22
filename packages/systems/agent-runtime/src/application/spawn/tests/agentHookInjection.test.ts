/**
 * Black-box tests for the pure command-string transformations in
 * agentHookInjection.ts.
 *
 * Inputs: command strings exactly as they appear in settings.agents
 * defaults. Outputs: the same strings with --settings injected at the
 * right spot (or unchanged for non-Claude agents).
 */

import {describe, it, expect} from 'vitest'
import {
    detectAgentCli,
    injectClaudeSettingsFlag,
    buildClaudeHookSettingsJson,
    buildCodexHookFlags,
    injectCodexHookFlags,
} from '../agentHookInjection'

describe('detectAgentCli', () => {
    it('recognises bare claude command', () => {
        expect(detectAgentCli('claude --dangerously-skip-permissions "$AGENT_PROMPT"')).toBe('claude')
    })

    it('recognises claude after leading env-var assignments', () => {
        expect(detectAgentCli('CLAUDE_CODE_NO_FLICKER=1 claude --dangerously-skip-permissions "$AGENT_PROMPT"'))
            .toBe('claude')
    })

    it('recognises claude after multiple env-var assignments', () => {
        expect(detectAgentCli('FOO=1 BAR=baz claude "$AGENT_PROMPT"')).toBe('claude')
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
        expect(detectAgentCli('acli rovodev run "$AGENT_PROMPT"')).toBe('other')
    })

    it('returns other for empty / whitespace command', () => {
        expect(detectAgentCli('')).toBe('other')
        expect(detectAgentCli('   ')).toBe('other')
    })
})

describe('injectClaudeSettingsFlag', () => {
    const PATH = '/Users/foo/Library/Application Support/VoiceTree/agent-hooks/claude-code-settings.json'

    it('inserts --settings right after claude (bare command)', () => {
        const result = injectClaudeSettingsFlag('claude --dangerously-skip-permissions "$AGENT_PROMPT"', PATH)
        expect(result).toBe(
            `claude --settings '/Users/foo/Library/Application Support/VoiceTree/agent-hooks/claude-code-settings.json' --dangerously-skip-permissions "$AGENT_PROMPT"`,
        )
    })

    it('inserts --settings right after claude (with leading env vars)', () => {
        const result = injectClaudeSettingsFlag(
            'CLAUDE_CODE_NO_FLICKER=1 claude --dangerously-skip-permissions "$AGENT_PROMPT"',
            PATH,
        )
        expect(result).toBe(
            `CLAUDE_CODE_NO_FLICKER=1 claude --settings '/Users/foo/Library/Application Support/VoiceTree/agent-hooks/claude-code-settings.json' --dangerously-skip-permissions "$AGENT_PROMPT"`,
        )
    })

    it('inserts --settings before --model when both follow claude', () => {
        const result = injectClaudeSettingsFlag(
            'CLAUDE_CODE_NO_FLICKER=1 claude --dangerously-skip-permissions --model sonnet "$AGENT_PROMPT"',
            PATH,
        )
        expect(result).toContain(`claude --settings '${PATH}' --dangerously-skip-permissions --model sonnet`)
    })

    it('shell-quotes the path properly (handles spaces)', () => {
        const result = injectClaudeSettingsFlag('claude "$AGENT_PROMPT"', PATH)
        expect(result).toContain(`--settings '${PATH}'`)
    })

    it('escapes single quotes in the path', () => {
        const weirdPath = "/Users/it's me/settings.json"
        const result = injectClaudeSettingsFlag('claude "$AGENT_PROMPT"', weirdPath)
        // shellQuote wraps in single quotes and escapes embedded ones as '\''
        expect(result).toContain(`--settings '/Users/it'\\''s me/settings.json'`)
    })

    it('idempotent — does not double-inject if --settings is already present', () => {
        const cmd = `claude --settings '/some/other/path.json' --dangerously-skip-permissions "$AGENT_PROMPT"`
        expect(injectClaudeSettingsFlag(cmd, PATH)).toBe(cmd)
    })

    it('idempotent — also detects --settings=value form', () => {
        const cmd = `claude --settings=/some/other/path.json "$AGENT_PROMPT"`
        expect(injectClaudeSettingsFlag(cmd, PATH)).toBe(cmd)
    })

    it('leaves non-claude commands unchanged', () => {
        const codex = 'codex "$AGENT_PROMPT"'
        expect(injectClaudeSettingsFlag(codex, PATH)).toBe(codex)
        const gemini = 'gemini -i "$AGENT_PROMPT"'
        expect(injectClaudeSettingsFlag(gemini, PATH)).toBe(gemini)
    })

    it('handles empty command without throwing', () => {
        expect(injectClaudeSettingsFlag('', PATH)).toBe('')
    })
})

describe('buildCodexHookFlags', () => {
    it('produces four -c flags, including PostToolUse', () => {
        const flags = buildCodexHookFlags(3002, 'Jin')
        expect(flags.match(/-c /g)?.length).toBe(4)
        expect(flags).toContain('hooks.Stop=')
        expect(flags).toContain('hooks.PermissionRequest=')
        expect(flags).toContain('hooks.UserPromptSubmit=')
        expect(flags).toContain('hooks.PostToolUse=')
    })

    it('bakes in mcpPort and terminalId (no shell-var refs)', () => {
        const flags = buildCodexHookFlags(3002, 'Jin')
        expect(flags).toContain('localhost:3002')
        expect(flags).toContain('terminal=Jin')
        expect(flags).not.toContain('$VOICETREE_MCP_PORT')
        expect(flags).not.toContain('$VOICETREE_TERMINAL_ID')
    })

    it('URL-encodes the terminalId', () => {
        const flags = buildCodexHookFlags(3002, 'agent with spaces')
        expect(flags).toContain('terminal=agent%20with%20spaces')
    })

    it('wraps each -c value in single quotes and uses Codex hook groups', () => {
        const flags = buildCodexHookFlags(3002, 'Jin')
        // Each flag like `-c 'hooks.Stop=[{hooks=[{type="command",...}]}]'`
        expect(flags).toMatch(/-c 'hooks\.Stop=\[\{hooks=\[\{type="command"/)
        expect(flags).toMatch(/\]'(\s|$)/)
        expect(flags).toContain('\\"Content-Type: application/json\\"')
    })

    it('targets /hook/codex on the right port', () => {
        const flags = buildCodexHookFlags(4242, 'Jin')
        expect(flags).toContain('http://localhost:4242/hook/codex')
    })

    it('sets Content-Type: application/json on the curl command (Express body parser needs it)', () => {
        const flags = buildCodexHookFlags(3002, 'Jin')
        expect(flags).toContain('Content-Type: application/json')
    })

    it('bakes the event name into the URL as ?event=<Name> (defence against body-parsing surprises)', () => {
        const flags = buildCodexHookFlags(3002, 'Jin')
        expect(flags).toContain('event=Stop')
        expect(flags).toContain('event=PermissionRequest')
        expect(flags).toContain('event=UserPromptSubmit')
        expect(flags).toContain('event=PostToolUse')
    })

    it('adds a blocking PostToolUse file-size check for Codex edits', () => {
        const flags = buildCodexHookFlags(3002, 'Jin')
        expect(flags).toContain('matcher="^(apply_patch|Edit|Write|MultiEdit)$"')
        expect(flags).toContain('webapp/.claude/hooks/file-size-check.cjs')
        expect(flags).toContain('timeout=30')
        expect(flags).toContain('statusMessage="Checking edited file sizes"')
    })
})

describe('injectCodexHookFlags', () => {
    it('inserts the flags right after the codex token', () => {
        const result = injectCodexHookFlags('codex "$AGENT_PROMPT"', 3002, 'Jin')
        // After codex, before "$AGENT_PROMPT"
        expect(result).toMatch(/^codex -c 'hooks\.Stop=.+ -c 'hooks\.PermissionRequest=.+ -c 'hooks\.UserPromptSubmit=.+ -c 'hooks\.PostToolUse=.+ "\$AGENT_PROMPT"$/)
    })

    it('inserts after codex when other flags follow', () => {
        const result = injectCodexHookFlags('codex --model gpt-5 "$AGENT_PROMPT"', 3002, 'Jin')
        expect(result).toContain('codex -c')
        expect(result).toContain('--model gpt-5')
        // hooks come before --model
        expect(result.indexOf('-c \'hooks.')).toBeLessThan(result.indexOf('--model'))
    })

    it('inserts after codex when leading env vars are present', () => {
        const result = injectCodexHookFlags('CODEX_HOME=/foo codex "$AGENT_PROMPT"', 3002, 'Jin')
        expect(result).toMatch(/^CODEX_HOME=\/foo codex -c 'hooks\.Stop=/)
    })

    it('idempotent — does not double-inject if user already configured -c hooks.', () => {
        const cmd = `codex -c 'hooks.Stop=[{type="command",command="echo hi"}]' "$AGENT_PROMPT"`
        expect(injectCodexHookFlags(cmd, 3002, 'Jin')).toBe(cmd)
    })

    it('idempotent — also detects -c "hooks.Stop=..." with double quotes', () => {
        const cmd = `codex -c "hooks.Stop=[{type='command',command='echo hi'}]" "$AGENT_PROMPT"`
        expect(injectCodexHookFlags(cmd, 3002, 'Jin')).toBe(cmd)
    })

    it('leaves non-codex commands unchanged', () => {
        const claude = 'claude --dangerously-skip-permissions "$AGENT_PROMPT"'
        expect(injectCodexHookFlags(claude, 3002, 'Jin')).toBe(claude)
    })

    it('handles empty command without throwing', () => {
        expect(injectCodexHookFlags('', 3002, 'Jin')).toBe('')
    })
})

describe('buildClaudeHookSettingsJson', () => {
    it('returns valid JSON', () => {
        const json = buildClaudeHookSettingsJson()
        expect(() => JSON.parse(json)).not.toThrow()
    })

    it('contains the five hook events VoiceTree listens for', () => {
        const settings = JSON.parse(buildClaudeHookSettingsJson()) as {hooks: Record<string, unknown>}
        expect(Object.keys(settings.hooks).sort()).toEqual(['Notification', 'PostToolUse', 'PreToolUse', 'Stop', 'UserPromptSubmit'])
    })

    it('hook commands reference VOICETREE_MCP_PORT and VOICETREE_TERMINAL_ID env vars', () => {
        const json = buildClaudeHookSettingsJson()
        expect(json).toContain('${VOICETREE_MCP_PORT}')
        expect(json).toContain('${VOICETREE_TERMINAL_ID}')
    })

    it('hook command POSTs to /hook/claude-code', () => {
        const json = buildClaudeHookSettingsJson()
        expect(json).toContain('/hook/claude-code')
    })

    it('hook command is fire-and-forget (errors silenced, exit clamped)', () => {
        const json = buildClaudeHookSettingsJson()
        expect(json).toContain('>/dev/null 2>&1 || true')
        expect(json).toContain('--max-time 2')
    })

    it('hook command sets Content-Type: application/json (Express body parser needs it)', () => {
        const json = buildClaudeHookSettingsJson()
        expect(json).toContain('Content-Type: application/json')
    })

    it('hook URL bakes in the event name as ?event=<Name>', () => {
        const settings = JSON.parse(buildClaudeHookSettingsJson()) as {hooks: Record<string, Array<{hooks: Array<{command: string}>}>>}
        expect(settings.hooks.Notification[0].hooks[0].command).toContain('event=Notification')
        expect(settings.hooks.Stop[0].hooks[0].command).toContain('event=Stop')
        expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toContain('event=UserPromptSubmit')
        expect(settings.hooks.PreToolUse[0].hooks[0].command).toContain('event=PreToolUse')
        expect(settings.hooks.PostToolUse[0].hooks[0].command).toContain('event=PostToolUse')
    })

    it('PreToolUse and PostToolUse entries have matcher restricted to AskUserQuestion', () => {
        const settings = JSON.parse(buildClaudeHookSettingsJson()) as {hooks: Record<string, Array<{matcher?: string; hooks: Array<{command: string}>}>>}
        expect(settings.hooks.PreToolUse[0].matcher).toBe('AskUserQuestion')
        expect(settings.hooks.PostToolUse[0].matcher).toBe('AskUserQuestion')
    })

    it('non-tool-use hooks do not have a matcher field', () => {
        const settings = JSON.parse(buildClaudeHookSettingsJson()) as {hooks: Record<string, Array<{matcher?: string}>>}
        expect(settings.hooks.Notification[0].matcher).toBeUndefined()
        expect(settings.hooks.Stop[0].matcher).toBeUndefined()
        expect(settings.hooks.UserPromptSubmit[0].matcher).toBeUndefined()
    })
})
