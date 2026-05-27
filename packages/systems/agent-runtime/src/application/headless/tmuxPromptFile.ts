/**
 * Phase 6 prompt delivery: route the agent prompt around tmux's argv plane.
 *
 * tmux's command-protocol buffer overflows on large -e KEY=VALUE entries
 * (empirically ~70 vars × multi-KB combined). The prompt is the only var
 * that crosses that line. This module:
 *   1. Writes the prompt to `{vault}/.voicetree/terminals/{name}-prompt.txt`
 *      (mode 0600). The big string never crosses tmux's argv.
 *   2. Rewrites the agent invocation to consume the file:
 *        - claude / gemini → stdin redirection (`< {file}`)
 *        - codex          → argv via `"$(cat {file})"` (positional)
 *        - other (fake)   → no argv rewrite; the agent reads
 *                           `AGENT_PROMPT_FILE` from env (see fake-agent).
 *   3. Replaces `AGENT_PROMPT` in the spawn env with `AGENT_PROMPT_FILE`
 *      so consumers that read from env keep working.
 *   4. Exposes a tmux readiness gate + sendKeys injection helper for the
 *      headful path (spawn `bash`, wait for shell ready, type the command).
 *
 * Symmetric design: both headless and headful share the on-disk prompt
 * artifact; only "exec at spawn" vs "inject via send-keys" differs.
 */

import {chmodSync, mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {spawn} from 'node:child_process'
import {join} from 'node:path'
import type {TerminalId} from '../terminals/terminal-registry/types'
import {getRecoveryMetadataDir} from '../recovery/paths'
import {detectCliType, type SupportedHeadlessCli} from '../spawn/headlessCli'
import {getTmuxBinaryPath, getTmuxCommandArgs} from '../terminals/tmux/tmux-server'
import {resolveTmuxSessionName, sendKeys} from '../terminals/tmux/tmux-session-manager'

function tmuxOk(args: string[]): Promise<boolean> {
    return new Promise((resolve) => {
        try {
            const child = spawn(getTmuxBinaryPath(), getTmuxCommandArgs(args), {stdio: 'ignore'})
            child.on('error', () => resolve(false))
            child.on('close', (code: number | null) => resolve(code === 0))
        } catch {
            resolve(false)
        }
    })
}

export function promptFilePath(projectRoot: string, terminalId: TerminalId): string {
    return join(getRecoveryMetadataDir(projectRoot), `${terminalId}-prompt.txt`)
}

export function writePromptFile(projectRoot: string, terminalId: TerminalId, prompt: string): string {
    const target: string = promptFilePath(projectRoot, terminalId)
    mkdirSync(getRecoveryMetadataDir(projectRoot), {recursive: true})
    writeFileSync(target, prompt, {encoding: 'utf8', mode: 0o600})
    // belt-and-braces: writeFileSync mode is masked by umask on some systems
    chmodSync(target, 0o600)
    return target
}

export function deletePromptFile(projectRoot: string | undefined, terminalId: TerminalId): void {
    if (!projectRoot) return
    rmSync(promptFilePath(projectRoot, terminalId), {force: true})
}

export function deletePromptFileByPath(path: string | null | undefined): void {
    if (!path) return
    try { rmSync(path, {force: true}) } catch { /* best-effort */ }
}

function shellSingleQuote(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`
}

function positionalPromptPatterns(): readonly RegExp[] {
    return [
        /\s*"\$AGENT_PROMPT"/g,
        /\s*'\$AGENT_PROMPT'/g,
        /\s*\$AGENT_PROMPT(?=\b|$)/g,
    ]
}

function stripPositionalPromptArg(command: string): string {
    let stripped: string = command
    for (const pattern of positionalPromptPatterns()) {
        stripped = stripped.replace(pattern, '')
    }
    return stripped.replace(/\s+/g, ' ').trim()
}

/**
 * Rewrite the agent invocation to consume the prompt from `promptFile`.
 * CLI-aware: stdin for claude/gemini, `$(cat ...)` argv for codex, env-only for the rest.
 */
export function rewriteCommandForPromptFile(command: string, promptFile: string): string {
    const stripped: string = stripPositionalPromptArg(command)
    const quotedFile: string = shellSingleQuote(promptFile)
    const cli: SupportedHeadlessCli | null = detectCliType(stripped)

    if (cli === 'claude' || cli === 'gemini') {
        return `${stripped} < ${quotedFile}`
    }
    if (cli === 'codex') {
        return `${stripped} "$(cat ${quotedFile})"`
    }
    // Unknown CLI (e.g. fake-agent): the agent must read AGENT_PROMPT_FILE
    // from env. Return the stripped command so argv stays short.
    return stripped
}

/**
 * Wrap a rewritten command in `bash -c 'unset AGENT_PROMPT; ...'` for the
 * headless tmux `new-session` argv. The `unset` defeats OS env-inheritance:
 * the parent shell's AGENT_PROMPT leaks via electron → tmux server → pane,
 * and tmux `-e KEY=` doesn't reliably override an inherited value across
 * tmux versions. The on-disk prompt file remains the sole source via
 * AGENT_PROMPT_FILE.
 *
 * Note: no `exec` — compound commands (`cmd && sleep N`) must run fully.
 */
export function wrapForHeadlessTmux(rewrittenCommand: string): string {
    return `bash -c ${shellSingleQuote(`unset AGENT_PROMPT; ${rewrittenCommand}`)}`
}

export type PromptFileSpawnPlan = {
    readonly command: string
    readonly env: Record<string, string>
    readonly promptFilePath: string | null
}

/**
 * For a headless tmux spawn: extract AGENT_PROMPT from env, write to disk,
 * rewrite the command for the CLI, and replace AGENT_PROMPT with
 * AGENT_PROMPT_FILE in env. If there's no AGENT_PROMPT (non-agent spawn),
 * return inputs unchanged.
 */
export function applyPromptFileToHeadlessSpawn(args: {
    readonly projectRoot: string
    readonly terminalId: TerminalId
    readonly command: string
    readonly env: Record<string, string>
}): PromptFileSpawnPlan {
    const prompt: string | undefined = args.env.AGENT_PROMPT
    if (!prompt) {
        return {command: args.command, env: args.env, promptFilePath: null}
    }
    const filePath: string = writePromptFile(args.projectRoot, args.terminalId, prompt)
    const rewritten: string = rewriteCommandForPromptFile(args.command, filePath)
    const wrapped: string = wrapForHeadlessTmux(rewritten)
    const {AGENT_PROMPT: _drop, ...rest} = args.env
    // Explicit '' override: deleting the key from the tmux -e list does NOT
    // unset values inherited via OS env-inheritance through the
    // electron → tmux server → bash → node chain. Setting AGENT_PROMPT=''
    // shadows any leaked parent-shell value so the agent reaches the
    // AGENT_PROMPT_FILE fallback path.
    return {
        command: wrapped,
        env: {...rest, AGENT_PROMPT: '', AGENT_PROMPT_FILE: filePath},
        promptFilePath: filePath,
    }
}

/**
 * Round-trip via `tmux display-message` so we know the tmux server is
 * responsive and the pane shell has had a tick to start. Cheaper and more
 * deterministic than a fixed-delay sleep.
 */
export async function waitForTmuxShellReady(terminalId: TerminalId): Promise<void> {
    // Round-trip tmux display-message. If it fails, sendKeys will surface
    // the real error to the caller — this gate is best-effort.
    await tmuxOk(['display-message', '-p', '-t', resolveTmuxSessionName(terminalId), 'ready'])
}

/**
 * Headful tmux: the pane already runs `bash`; inject the agent command via
 * send-keys after a readiness gate. The command is sent literally — the
 * pane's bash already has `AGENT_PROMPT` in its env (passed via tmux `-e`
 * at session create), so the user-facing template (e.g.
 * `claude "$AGENT_PROMPT"`) just works. Returns the command line that was
 * sent (useful for diagnostics).
 */
export async function injectAgentCommandHeadful(args: {
    readonly terminalId: TerminalId
    readonly command: string
}): Promise<string> {
    await waitForTmuxShellReady(args.terminalId)
    await sendKeys(args.terminalId, args.command)
    return args.command
}
