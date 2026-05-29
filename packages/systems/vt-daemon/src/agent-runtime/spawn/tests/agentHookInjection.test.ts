/**
 * Black-box tests for the pure command-string transformations in
 * agentHookInjection.ts.
 *
 * Inputs: command strings exactly as they appear in settings.agents
 * defaults. Outputs: the same strings with --settings injected at the
 * right spot (or unchanged for non-Claude agents).
 *
 * Step 9b: hooks target the unified HTTP daemon (`$VOICETREE_DAEMON_URL`)
 * with the bearer token read inline via
 * `cat "$VOICETREE_PROJECT_PATH/.voicetree/auth-token"`. No port-only refs,
 * no token-in-env-or-argv.
 */

import {describe, it, expect} from 'vitest'
import {
    detectAgentCli,
    injectClaudeSettingsFlag,
    buildClaudeHookSettingsJson,
    buildCodexHookFlags,
    injectCodexHookFlags,
} from '../agentHookInjection'

const DAEMON_URL: string = 'http://127.0.0.1:51337'

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
        expect(result).toContain(`claude --settings '${PATH}'`)
    })

    it('escapes single quotes in the path', () => {
        const weirdPath = "/Users/it's me/settings.json"
        const result = injectClaudeSettingsFlag('claude "$AGENT_PROMPT"', weirdPath)
        expect(result).toContain(`--settings '/Users/it'\\''s me/settings.json'`)
    })

    it('idempotent — does not double-inject if --settings is already present', () => {
        const cmd = `claude --settings '/some/other/path.json' --dangerously-skip-permissions "$AGENT_PROMPT"`
        expect(injectClaudeSettingsFlag(cmd, PATH)).toBe(cmd)
    })

    it('leaves non-claude commands unchanged', () => {
        const codex = 'codex "$AGENT_PROMPT"'
        expect(injectClaudeSettingsFlag(codex, PATH)).toBe(codex)
    })

    it('handles empty command without throwing', () => {
        expect(injectClaudeSettingsFlag('', PATH)).toBe('')
    })
})

describe('buildCodexHookFlags', () => {
    it('produces three -c flags, one per hook event', () => {
        const flags = buildCodexHookFlags(DAEMON_URL, 'Jin')
        expect(flags.match(/-c /g)?.length).toBe(3)
        expect(flags).toContain('hooks.Stop=')
        expect(flags).toContain('hooks.PermissionRequest=')
        expect(flags).toContain('hooks.UserPromptSubmit=')
    })

    it('bakes in daemonUrl and terminalId, never the bearer token', () => {
        const flags = buildCodexHookFlags(DAEMON_URL, 'Jin')
        expect(flags).toContain('127.0.0.1:51337')
        expect(flags).toContain('terminal=Jin')
        // No legacy env-var refs.
        expect(flags).not.toContain('$VOICETREE_HOOK_PORT')
        expect(flags).not.toContain('$VOICETREE_MCP_PORT')
        // Token MUST NOT be on the command line — design doc §3.3 / §4.4.
        expect(flags).not.toContain('Bearer ${VOICETREE_AUTH_TOKEN}')
        expect(flags).not.toMatch(/Bearer [a-f0-9]{16,}/)
    })

    it('reads the bearer token via `cat` from the vault auth-token file', () => {
        const flags = buildCodexHookFlags(DAEMON_URL, 'Jin')
        // The TOML-escaped form has \" instead of " — the test asserts the
        // inner-quoted-cat substring with escapes.
        expect(flags).toContain('TOKEN=$(cat \\"$VOICETREE_PROJECT_PATH/.voicetree/auth-token\\")')
        expect(flags).toContain('Authorization: Bearer $TOKEN')
    })

    it('URL-encodes the terminalId', () => {
        const flags = buildCodexHookFlags(DAEMON_URL, 'agent with spaces')
        expect(flags).toContain('terminal=agent%20with%20spaces')
    })

    it('targets /hook/codex on the right URL', () => {
        const flags = buildCodexHookFlags('http://10.0.0.7:4242', 'Jin')
        expect(flags).toContain('http://10.0.0.7:4242/hook/codex')
    })

    it('sets Content-Type: application/json on the curl command', () => {
        const flags = buildCodexHookFlags(DAEMON_URL, 'Jin')
        expect(flags).toContain('Content-Type: application/json')
    })

    it('bakes the event name into the URL as ?event=<Name>', () => {
        const flags = buildCodexHookFlags(DAEMON_URL, 'Jin')
        expect(flags).toContain('event=Stop')
        expect(flags).toContain('event=PermissionRequest')
        expect(flags).toContain('event=UserPromptSubmit')
    })
})

describe('injectCodexHookFlags', () => {
    it('inserts the flags right after the codex token', () => {
        const result = injectCodexHookFlags('codex "$AGENT_PROMPT"', DAEMON_URL, 'Jin')
        expect(result).toMatch(/^codex -c 'hooks\.Stop=.+ -c 'hooks\.PermissionRequest=.+ -c 'hooks\.UserPromptSubmit=.+ "\$AGENT_PROMPT"$/)
    })

    it('inserts after codex when other flags follow', () => {
        const result = injectCodexHookFlags('codex --model gpt-5 "$AGENT_PROMPT"', DAEMON_URL, 'Jin')
        expect(result).toContain('codex -c')
        expect(result.indexOf("-c 'hooks.")).toBeLessThan(result.indexOf('--model'))
    })

    it('idempotent — does not double-inject if user already configured -c hooks.', () => {
        const cmd = `codex -c 'hooks.Stop=[{type="command",command="echo hi"}]' "$AGENT_PROMPT"`
        expect(injectCodexHookFlags(cmd, DAEMON_URL, 'Jin')).toBe(cmd)
    })

    it('leaves non-codex commands unchanged', () => {
        const claude = 'claude --dangerously-skip-permissions "$AGENT_PROMPT"'
        expect(injectCodexHookFlags(claude, DAEMON_URL, 'Jin')).toBe(claude)
    })

    it('handles empty command without throwing', () => {
        expect(injectCodexHookFlags('', DAEMON_URL, 'Jin')).toBe('')
    })
})

describe('buildClaudeHookSettingsJson', () => {
    it('returns valid JSON', () => {
        expect(() => JSON.parse(buildClaudeHookSettingsJson())).not.toThrow()
    })

    it('contains the five hook events VoiceTree listens for', () => {
        const settings = JSON.parse(buildClaudeHookSettingsJson()) as {hooks: Record<string, unknown>}
        expect(Object.keys(settings.hooks).sort()).toEqual(['Notification', 'PostToolUse', 'PreToolUse', 'Stop', 'UserPromptSubmit'])
    })

    it('hook commands reference VOICETREE_DAEMON_URL + VOICETREE_PROJECT_PATH + VOICETREE_TERMINAL_ID', () => {
        const settings = JSON.parse(buildClaudeHookSettingsJson()) as {hooks: Record<string, Array<{hooks: Array<{command: string}>}>>}
        const cmd: string = settings.hooks.Notification[0].hooks[0].command
        expect(cmd).toContain('${VOICETREE_DAEMON_URL}')
        expect(cmd).toContain('${VOICETREE_TERMINAL_ID}')
        // VAULT_PATH appears inside a double-quoted shell string — idiomatic
        // `$VAR` form, not `${VAR}`.
        expect(cmd).toContain('$VOICETREE_PROJECT_PATH/.voicetree/auth-token')
        // Legacy refs gone.
        expect(cmd).not.toContain('${VOICETREE_HOOK_PORT}')
        expect(cmd).not.toContain('${VOICETREE_MCP_PORT}')
    })

    it('reads the bearer token via `cat` from the vault auth-token file (no token on argv)', () => {
        const settings = JSON.parse(buildClaudeHookSettingsJson()) as {hooks: Record<string, Array<{hooks: Array<{command: string}>}>>}
        const cmd: string = settings.hooks.Notification[0].hooks[0].command
        expect(cmd).toContain('TOKEN=$(cat "$VOICETREE_PROJECT_PATH/.voicetree/auth-token")')
        expect(cmd).toContain('Authorization: Bearer $TOKEN')
        // Bearer is sourced from `$TOKEN`; the literal env-var Bearer
        // shorthand (which would let `ps` see the token via env) is not used.
        expect(cmd).not.toContain('Bearer ${VOICETREE_AUTH_TOKEN}')
    })

    it('hook command POSTs to /hook/claude-code', () => {
        expect(buildClaudeHookSettingsJson()).toContain('/hook/claude-code')
    })

    it('hook command is fire-and-forget (errors silenced, exit clamped)', () => {
        const json = buildClaudeHookSettingsJson()
        expect(json).toContain('>/dev/null 2>&1 || true')
        expect(json).toContain('--max-time 2')
    })

    it('hook command sets Content-Type: application/json', () => {
        expect(buildClaudeHookSettingsJson()).toContain('Content-Type: application/json')
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
        const settings = JSON.parse(buildClaudeHookSettingsJson()) as {hooks: Record<string, Array<{matcher?: string}>>}
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
