/**
 * Phase 6: prompt-file delivery primitives. Black-box assertions on the
 * observable side effects (file content, mode, command shape) — no internal
 * mocking. Lives next to the function under test per repo convention.
 */
import {existsSync, mkdtempSync, readFileSync, rmSync, statSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {describe, expect, it, beforeEach, afterEach} from 'vitest'
import type {TerminalId} from '@vt/agent-runtime/terminals/terminal-registry/types.ts'
import {
    applyPromptFileToHeadlessSpawn,
    applyPromptFileToTmuxSpawn,
    deletePromptFile,
    deletePromptFileByPath,
    promptFilePath,
    rewriteCommandForPromptFile,
    wrapForHeadlessTmux,
    writePromptFile,
} from '../tmuxPromptFile'

let vault: string

beforeEach(() => {
    vault = mkdtempSync(join(tmpdir(), 'vt-prompt-file-'))
})
afterEach(() => {
    rmSync(vault, {recursive: true, force: true})
})

const tid = (name: string): TerminalId => name as TerminalId

describe('promptFilePath', () => {
    it('returns {vault}/.voicetree/terminals/{name}-prompt.txt', () => {
        expect(promptFilePath(vault, tid('Aki'))).toBe(
            join(vault, '.voicetree', 'terminals', 'Aki-prompt.txt'),
        )
    })
})

describe('writePromptFile / deletePromptFile', () => {
    it('writes the prompt to disk with mode 0600 and the expected content', () => {
        const path: string = writePromptFile(vault, tid('Aki'), 'hello prompt')
        expect(existsSync(path)).toBe(true)
        expect(readFileSync(path, 'utf8')).toBe('hello prompt')
        const mode: number = statSync(path).mode & 0o777
        expect(mode).toBe(0o600)
    })

    it('overwrites an existing prompt file', () => {
        writePromptFile(vault, tid('Aki'), 'first')
        const path: string = writePromptFile(vault, tid('Aki'), 'second')
        expect(readFileSync(path, 'utf8')).toBe('second')
    })

    it('deletes the prompt file by vault+id', () => {
        const path: string = writePromptFile(vault, tid('Aki'), 'x')
        deletePromptFile(vault, tid('Aki'))
        expect(existsSync(path)).toBe(false)
    })

    it('deletePromptFile is a no-op when the file is missing', () => {
        expect(() => deletePromptFile(vault, tid('Ghost'))).not.toThrow()
    })

    it('deletePromptFileByPath handles null / missing files', () => {
        expect(() => deletePromptFileByPath(null)).not.toThrow()
        expect(() => deletePromptFileByPath('/nope/does/not/exist')).not.toThrow()
    })
})

describe('rewriteCommandForPromptFile (CLI-aware)', () => {
    it('claude: strips $AGENT_PROMPT positional and appends stdin redirection', () => {
        const out: string = rewriteCommandForPromptFile(
            'claude --dangerously-skip-permissions "$AGENT_PROMPT"',
            '/v/.voicetree/terminals/Aki-prompt.txt',
        )
        expect(out).toBe(
            `claude --dangerously-skip-permissions < '/v/.voicetree/terminals/Aki-prompt.txt'`,
        )
    })

    it('codex: replaces $AGENT_PROMPT with $(cat file) (positional)', () => {
        const out: string = rewriteCommandForPromptFile(
            'codex exec --full-auto "$AGENT_PROMPT"',
            '/v/.voicetree/terminals/Aki-prompt.txt',
        )
        expect(out).toBe(
            `codex exec --full-auto "$(cat '/v/.voicetree/terminals/Aki-prompt.txt')"`,
        )
    })

    it('gemini: stdin redirection like claude', () => {
        const out: string = rewriteCommandForPromptFile(
            'gemini --yolo "$AGENT_PROMPT"',
            '/v/x.txt',
        )
        expect(out).toBe(`gemini --yolo < '/v/x.txt'`)
    })

    it('unknown CLI (fake-agent): strips $AGENT_PROMPT but adds no redirection', () => {
        const out: string = rewriteCommandForPromptFile(
            'node tools/vt-fake-agent/dist/index.js "$AGENT_PROMPT"',
            '/v/Aki-prompt.txt',
        )
        // Fake-agent reads AGENT_PROMPT_FILE from env (set by spawn flow)
        expect(out).toBe('node tools/vt-fake-agent/dist/index.js')
    })

    it("handles -p '$AGENT_PROMPT' single-quoted form", () => {
        const out: string = rewriteCommandForPromptFile(
            `claude -p '$AGENT_PROMPT'`,
            '/v/p.txt',
        )
        expect(out).toBe(`claude -p < '/v/p.txt'`)
    })

    it('shell-quotes paths with spaces', () => {
        const out: string = rewriteCommandForPromptFile(
            'claude "$AGENT_PROMPT"',
            '/has space/p.txt',
        )
        expect(out).toBe(`claude < '/has space/p.txt'`)
    })

    it('detects claude past a leading shell env-var assignment (default template)', () => {
        const out: string = rewriteCommandForPromptFile(
            `CLAUDE_CODE_NO_FLICKER=1 claude --dangerously-skip-permissions "$AGENT_PROMPT"`,
            '/v/.voicetree/terminals/Aki-prompt.txt',
        )
        expect(out).toBe(
            `CLAUDE_CODE_NO_FLICKER=1 claude --dangerously-skip-permissions < '/v/.voicetree/terminals/Aki-prompt.txt'`,
        )
    })
})

describe('wrapForHeadlessTmux', () => {
    it("wraps in bash -c '...' to unset AGENT_PROMPT and run the command", () => {
        const out: string = wrapForHeadlessTmux(`claude --print < '/v/p.txt'`)
        expect(out).toBe(`bash -c 'unset AGENT_PROMPT; claude --print < '\\''/v/p.txt'\\'''`)
    })

    it('preserves compound commands so both sides of && run', () => {
        const out: string = wrapForHeadlessTmux(`echo marker && sleep 10`)
        expect(out).toBe(`bash -c 'unset AGENT_PROMPT; echo marker && sleep 10'`)
    })
})

describe('applyPromptFileToTmuxSpawn (mode-agnostic primitive)', () => {
    it('writes the prompt, CLI-rewrites the command (no bash wrap), and clears AGENT_PROMPT in favor of AGENT_PROMPT_FILE', () => {
        const plan = applyPromptFileToTmuxSpawn({
            projectRoot: vault,
            terminalId: tid('Aki'),
            command: 'claude "$AGENT_PROMPT"',
            env: {AGENT_PROMPT: 'task body', VOICETREE_TERMINAL_ID: 'Aki'},
        })
        expect(plan.promptFilePath).toBe(promptFilePath(vault, tid('Aki')))
        expect(readFileSync(plan.promptFilePath!, 'utf8')).toBe('task body')
        // No bash wrap — the interactive path send-keys this verbatim into a shell
        expect(plan.command).toBe(`claude < '${plan.promptFilePath}'`)
        expect(plan.env.AGENT_PROMPT).toBe('')
        expect(plan.env.AGENT_PROMPT_FILE).toBe(plan.promptFilePath)
        expect(plan.env.VOICETREE_TERMINAL_ID).toBe('Aki')
    })

    it('is a no-op when env has no AGENT_PROMPT', () => {
        const plan = applyPromptFileToTmuxSpawn({
            projectRoot: vault,
            terminalId: tid('Aki'),
            command: 'bash',
            env: {VOICETREE_TERMINAL_ID: 'Aki'},
        })
        expect(plan.promptFilePath).toBeNull()
        expect(plan.command).toBe('bash')
        expect(plan.env).toEqual({VOICETREE_TERMINAL_ID: 'Aki'})
    })

    it('handles a 200 KiB AGENT_PROMPT — spilling to file keeps the returned env tiny', () => {
        const giant: string = 'X'.repeat(200 * 1024)
        const plan = applyPromptFileToTmuxSpawn({
            projectRoot: vault,
            terminalId: tid('Aki'),
            command: 'claude "$AGENT_PROMPT"',
            env: {AGENT_PROMPT: giant, VOICETREE_TERMINAL_ID: 'Aki'},
        })
        expect(readFileSync(plan.promptFilePath!, 'utf8')).toBe(giant)
        expect(plan.env.AGENT_PROMPT).toBe('')
        // The returned env's serialized size must be far below tmux's
        // command-protocol buffer (≈256 KiB) — proving the big string spilled
        // to disk rather than staying in env.
        const envBytes: number = JSON.stringify(plan.env).length
        expect(envBytes).toBeLessThan(2_000)
    })
})

describe('applyPromptFileToHeadlessSpawn', () => {
    it('composes the mode-agnostic primitive with the headless bash-unset wrap', () => {
        const plan = applyPromptFileToHeadlessSpawn({
            projectRoot: vault,
            terminalId: tid('Aki'),
            command: 'claude "$AGENT_PROMPT"',
            env: {AGENT_PROMPT: 'task body', VOICETREE_TERMINAL_ID: 'Aki'},
        })
        expect(plan.promptFilePath).toBe(promptFilePath(vault, tid('Aki')))
        expect(readFileSync(plan.promptFilePath!, 'utf8')).toBe('task body')
        expect(plan.command).toContain(`bash -c 'unset AGENT_PROMPT; claude < `)
        expect(plan.env.AGENT_PROMPT).toBe('')
        expect(plan.env.AGENT_PROMPT_FILE).toBe(plan.promptFilePath)
        expect(plan.env.VOICETREE_TERMINAL_ID).toBe('Aki')
    })

    it('is a no-op when env has no AGENT_PROMPT', () => {
        const plan = applyPromptFileToHeadlessSpawn({
            projectRoot: vault,
            terminalId: tid('Aki'),
            command: 'bash',
            env: {VOICETREE_TERMINAL_ID: 'Aki'},
        })
        expect(plan.promptFilePath).toBeNull()
        expect(plan.command).toBe('bash')
        expect(plan.env).toEqual({VOICETREE_TERMINAL_ID: 'Aki'})
    })
})
