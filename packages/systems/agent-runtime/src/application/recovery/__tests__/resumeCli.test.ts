/**
 * Regression guard for §4 (Codex resume command shape).
 *
 * The shipped UI must produce a command whose first three tokens are
 * exactly `codex resume <sessionId>` — the form the user verified runs
 * manually. Any flag inserted between `resume` and `<sessionId>` (or any
 * transformation of the session id itself) would silently break recovery.
 *
 * Lives in the recovery directory rather than the builder directory so a
 * grep for "codex resume" while debugging recovery surfaces it directly.
 */

import {describe, expect, it} from 'vitest'
import {buildResumeCommand, type ResumeCommandRequest} from '../../spawn/resumeCli'

// User-verified working session id (CLAUDE.md task §4 fixture)
const VERIFIED_CODEX_SESSION_ID = '019e651e-b53e-79a0-815a-f6247aca3724'

// Real Stop-hook flag string extracted verbatim from Jin.json — the format
// the production tmux spawn writes when `--stop-hook` is configured.
const REAL_STOP_HOOK_FLAG = `-c 'hooks.Stop=[{type="command",command="curl -fsS -X POST -H \\"Content-Type: application/json\\" --max-time 2 --data-binary @- \\"http://localhost:3003/hook/codex?terminal=Jin&event=Stop\\" >/dev/null 2>&1 || true"}]'`
const REAL_PERMISSION_HOOK_FLAG = `-c 'hooks.PermissionRequest=[{type="command",command="curl -fsS -X POST -H \\"Content-Type: application/json\\" --max-time 2 --data-binary @- \\"http://localhost:3003/hook/codex?terminal=Jin&event=PermissionRequest\\" >/dev/null 2>&1 || true"}]'`
const REAL_USER_PROMPT_HOOK_FLAG = `-c 'hooks.UserPromptSubmit=[{type="command",command="curl -fsS -X POST -H \\"Content-Type: application/json\\" --max-time 2 --data-binary @- \\"http://localhost:3003/hook/codex?terminal=Jin&event=UserPromptSubmit\\" >/dev/null 2>&1 || true"}]'`

const REAL_JIN_INITIAL_COMMAND =
    `codex ${REAL_STOP_HOOK_FLAG} ${REAL_PERMISSION_HOOK_FLAG} ${REAL_USER_PROMPT_HOOK_FLAG} --yolo "$AGENT_PROMPT"`

describe('Codex resume command regression guard', () => {
    // §4.1
    it('interactive: first three tokens are exactly `codex`, `resume`, `<sessionId>`', () => {
        const req: ResumeCommandRequest = {
            cliType: 'codex',
            nativeSessionId: VERIFIED_CODEX_SESSION_ID,
            mode: 'interactive',
            originalCommand: 'codex',
        }
        const result = buildResumeCommand(req)
        expect(result.kind).toBe('supported')
        if (result.kind !== 'supported') return
        const tokens: readonly string[] = result.command.split(/\s+/)
        expect(tokens.slice(0, 3)).toEqual(['codex', 'resume', VERIFIED_CODEX_SESSION_ID])
        // No flags inserted between `resume` and the id: third token is the bare uuid.
        expect(tokens[2]).toBe(VERIFIED_CODEX_SESSION_ID)
        // Bare 3-token form when no original flags to preserve.
        expect(result.command).toBe(`codex resume ${VERIFIED_CODEX_SESSION_ID}`)
    })

    // §4.2
    it('headless: first four tokens are exactly `codex`, `exec`, `resume`, `<sessionId>`', () => {
        const req: ResumeCommandRequest = {
            cliType: 'codex',
            nativeSessionId: VERIFIED_CODEX_SESSION_ID,
            mode: 'headless',
            originalCommand: 'codex exec --full-auto "$AGENT_PROMPT"',
        }
        const result = buildResumeCommand(req)
        expect(result.kind).toBe('supported')
        if (result.kind !== 'supported') return
        const tokens: readonly string[] = result.command.split(/\s+/)
        expect(tokens.slice(0, 4)).toEqual(['codex', 'exec', 'resume', VERIFIED_CODEX_SESSION_ID])
    })

    // §4.3
    it('appends Stop-hook flag VERBATIM after the session id, never before', () => {
        const req: ResumeCommandRequest = {
            cliType: 'codex',
            nativeSessionId: VERIFIED_CODEX_SESSION_ID,
            mode: 'interactive',
            originalCommand: REAL_JIN_INITIAL_COMMAND,
        }
        const result = buildResumeCommand(req)
        expect(result.kind).toBe('supported')
        if (result.kind !== 'supported') return
        const expected: string = [
            'codex',
            'resume',
            VERIFIED_CODEX_SESSION_ID,
            REAL_STOP_HOOK_FLAG,
            REAL_PERMISSION_HOOK_FLAG,
            REAL_USER_PROMPT_HOOK_FLAG,
        ].join(' ')
        expect(result.command).toBe(expected)
        // The session id appears before any preserved hook flag.
        const idxOfId: number = result.command.indexOf(VERIFIED_CODEX_SESSION_ID)
        const idxOfStopHook: number = result.command.indexOf(REAL_STOP_HOOK_FLAG)
        expect(idxOfId).toBeGreaterThan(0)
        expect(idxOfStopHook).toBeGreaterThan(idxOfId)
        // No other tokens slipped in between resume and the id.
        const tokens: readonly string[] = result.command.split(/\s+/)
        expect(tokens.slice(0, 3)).toEqual(['codex', 'resume', VERIFIED_CODEX_SESSION_ID])
    })
})
