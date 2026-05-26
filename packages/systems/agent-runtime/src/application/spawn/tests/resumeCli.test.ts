/**
 * Black-box tests for the pure resume command builder in resumeCli.ts.
 *
 * Inputs: pre-detected CLI type, native session id, mode, and original command.
 * Outputs: exact resume command string or unsupported result with reason.
 * No internal mocks — pure input/output assertions only.
 */

import { describe, it, expect } from 'vitest'
import { buildResumeCommand, type ResumeCommandRequest } from '../cli/resumeCli'

const CLAUDE_SESSION_ID = '605904d4-8881-4261-adc8-212891622ed2'
const CODEX_THREAD_ID = '019e4ded-d566-7d52-b443-4610669da39e'
const HOOK_FLAGS = `-c 'hooks.Stop=[{type="command"}]' -c 'hooks.UserPromptSubmit=[{type="command"}]'`

describe('buildResumeCommand', () => {
    describe('Claude', () => {
        it('interactive: preserves env prefix and permission flags', () => {
            const req: ResumeCommandRequest = {
                cliType: 'claude',
                nativeSessionId: CLAUDE_SESSION_ID,
                mode: 'interactive',
                originalCommand: 'CLAUDE_CODE_NO_FLICKER=1 claude --dangerously-skip-permissions',
            }
            expect(buildResumeCommand(req)).toEqual({
                kind: 'supported',
                command: `CLAUDE_CODE_NO_FLICKER=1 claude --resume ${CLAUDE_SESSION_ID} --dangerously-skip-permissions`,
            })
        })

        it('headless: returns same form as interactive, stripping -p and prompt placeholder', () => {
            const req: ResumeCommandRequest = {
                cliType: 'claude',
                nativeSessionId: CLAUDE_SESSION_ID,
                mode: 'headless',
                originalCommand: 'CLAUDE_CODE_NO_FLICKER=1 claude --dangerously-skip-permissions -p "$AGENT_PROMPT"',
            }
            expect(buildResumeCommand(req)).toEqual({
                kind: 'supported',
                command: `CLAUDE_CODE_NO_FLICKER=1 claude --resume ${CLAUDE_SESSION_ID} --dangerously-skip-permissions`,
            })
        })

        it('strips --continue from the original command', () => {
            const req: ResumeCommandRequest = {
                cliType: 'claude',
                nativeSessionId: CLAUDE_SESSION_ID,
                mode: 'interactive',
                originalCommand: 'claude --continue --dangerously-skip-permissions',
            }
            expect(buildResumeCommand(req)).toEqual({
                kind: 'supported',
                command: `claude --resume ${CLAUDE_SESSION_ID} --dangerously-skip-permissions`,
            })
        })

        it('strips prior --resume <id> from the original command', () => {
            const req: ResumeCommandRequest = {
                cliType: 'claude',
                nativeSessionId: CLAUDE_SESSION_ID,
                mode: 'interactive',
                originalCommand: 'claude --resume old-session-id --dangerously-skip-permissions',
            }
            expect(buildResumeCommand(req)).toEqual({
                kind: 'supported',
                command: `claude --resume ${CLAUDE_SESSION_ID} --dangerously-skip-permissions`,
            })
        })

        it('strips prior --session-id <id> from the original command', () => {
            const req: ResumeCommandRequest = {
                cliType: 'claude',
                nativeSessionId: CLAUDE_SESSION_ID,
                mode: 'interactive',
                originalCommand: 'claude --session-id old-id --dangerously-skip-permissions',
            }
            expect(buildResumeCommand(req)).toEqual({
                kind: 'supported',
                command: `claude --resume ${CLAUDE_SESSION_ID} --dangerously-skip-permissions`,
            })
        })

        it('handles bare claude command with no extra flags', () => {
            const req: ResumeCommandRequest = {
                cliType: 'claude',
                nativeSessionId: CLAUDE_SESSION_ID,
                mode: 'interactive',
                originalCommand: 'claude',
            }
            expect(buildResumeCommand(req)).toEqual({
                kind: 'supported',
                command: `claude --resume ${CLAUDE_SESSION_ID}`,
            })
        })

        it('preserves --settings flag (injected by VoiceTree)', () => {
            const req: ResumeCommandRequest = {
                cliType: 'claude',
                nativeSessionId: CLAUDE_SESSION_ID,
                mode: 'interactive',
                originalCommand: "claude --settings '/path/to/settings.json' --dangerously-skip-permissions",
            }
            expect(buildResumeCommand(req)).toEqual({
                kind: 'supported',
                command: `claude --resume ${CLAUDE_SESSION_ID} --settings '/path/to/settings.json' --dangerously-skip-permissions`,
            })
        })
    })

    describe('Codex interactive', () => {
        it('returns codex resume <id> preserving hook flags', () => {
            const req: ResumeCommandRequest = {
                cliType: 'codex',
                nativeSessionId: CODEX_THREAD_ID,
                mode: 'interactive',
                originalCommand: `codex ${HOOK_FLAGS}`,
            }
            expect(buildResumeCommand(req)).toEqual({
                kind: 'supported',
                command: `codex resume ${CODEX_THREAD_ID} ${HOOK_FLAGS}`,
            })
        })

        it('returns codex resume <id> when no hook flags present', () => {
            const req: ResumeCommandRequest = {
                cliType: 'codex',
                nativeSessionId: CODEX_THREAD_ID,
                mode: 'interactive',
                originalCommand: 'codex',
            }
            expect(buildResumeCommand(req)).toEqual({
                kind: 'supported',
                command: `codex resume ${CODEX_THREAD_ID}`,
            })
        })
    })

    describe('Codex headless', () => {
        it('returns codex exec resume <id> preserving hook flags', () => {
            const req: ResumeCommandRequest = {
                cliType: 'codex',
                nativeSessionId: CODEX_THREAD_ID,
                mode: 'headless',
                originalCommand: `codex ${HOOK_FLAGS} exec --full-auto "$AGENT_PROMPT"`,
            }
            expect(buildResumeCommand(req)).toEqual({
                kind: 'supported',
                command: `codex exec resume ${CODEX_THREAD_ID} ${HOOK_FLAGS}`,
            })
        })

        it('returns codex exec resume <id> when no hook flags present', () => {
            const req: ResumeCommandRequest = {
                cliType: 'codex',
                nativeSessionId: CODEX_THREAD_ID,
                mode: 'headless',
                originalCommand: 'codex exec --full-auto "$AGENT_PROMPT"',
            }
            expect(buildResumeCommand(req)).toEqual({
                kind: 'supported',
                command: `codex exec resume ${CODEX_THREAD_ID}`,
            })
        })
    })

    describe('Unsupported cases', () => {
        it('returns gemini-not-supported for gemini CLI', () => {
            const req: ResumeCommandRequest = {
                cliType: 'gemini',
                nativeSessionId: 'session-123',
                mode: 'interactive',
                originalCommand: 'gemini --yolo',
            }
            expect(buildResumeCommand(req)).toEqual({ kind: 'unsupported', reason: 'gemini-not-supported' })
        })

        it('returns no-cli-detected when cliType is null', () => {
            const req: ResumeCommandRequest = {
                cliType: null,
                nativeSessionId: 'session-123',
                mode: 'interactive',
                originalCommand: 'unknown-tool --arg',
            }
            expect(buildResumeCommand(req)).toEqual({ kind: 'unsupported', reason: 'no-cli-detected' })
        })

        it('returns empty-session-id for empty string session id', () => {
            const req: ResumeCommandRequest = {
                cliType: 'claude',
                nativeSessionId: '',
                mode: 'interactive',
                originalCommand: 'claude --dangerously-skip-permissions',
            }
            expect(buildResumeCommand(req)).toEqual({ kind: 'unsupported', reason: 'empty-session-id' })
        })

        it('returns empty-session-id for whitespace-only session id', () => {
            const req: ResumeCommandRequest = {
                cliType: 'claude',
                nativeSessionId: '   ',
                mode: 'interactive',
                originalCommand: 'claude --dangerously-skip-permissions',
            }
            expect(buildResumeCommand(req)).toEqual({ kind: 'unsupported', reason: 'empty-session-id' })
        })

        it('returns empty-session-id even when cliType is also null (empty-session-id takes priority)', () => {
            const req: ResumeCommandRequest = {
                cliType: null,
                nativeSessionId: '',
                mode: 'interactive',
                originalCommand: 'unknown-tool',
            }
            expect(buildResumeCommand(req)).toEqual({ kind: 'unsupported', reason: 'empty-session-id' })
        })
    })
})
