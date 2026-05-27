import type {TerminalData, TerminalId} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry/types.ts'
import type {UnclaimedTmuxSession} from '@vt/vt-daemon/agent-runtime/terminals/tmux/unclaimed-tmux.ts'

/**
 * Capability struct for a single known terminal record.
 *
 * Each record can independently expose zero, one, or both of two action
 * capabilities:
 *
 * - `attach`: a live tmux pane exists under this terminal id → Attach button
 *   (re-grabs the orphaned pane).
 *
 * - `resume`: the metadata identifies a supported CLI (`claude`/`codex`) that
 *   could in principle be resumed → Resume button. The actual native session id
 *   (`--resume <sessionId>` / `resume <threadId>`) is NOT looked up at
 *   discovery time: scanning `~/.claude/projects` for a transcript match is
 *   expensive (1+ GB of `.jsonl` for heavy users) and discovery runs on a 10s
 *   poll. The lookup is deferred to the actual resume/fork action, where it
 *   runs exactly once per user click.
 *
 * `isClaimed` reports whether the terminal id is in the live in-memory
 * registry. UI decides where to render: claimed rows render in the regular
 * terminal tab strip; unclaimed rows render in the Surviving Agents section.
 *
 * Records with neither capability and no in-memory presence are filtered out
 * upstream by discovery (nothing the UI could do with them).
 */
export type RecoverableAgentSession = {
    readonly terminalId: TerminalId
    readonly agentName: string
    readonly metadataPath: string
    readonly terminalData: TerminalData
    readonly isClaimed: boolean
    readonly attach?: AttachCapability
    readonly resume?: ResumeCapability
}

export type AttachCapability = {
    readonly session: UnclaimedTmuxSession
}

export type ResumeCapability = {
    readonly cliType: 'claude' | 'codex'
}

/**
 * Per-record output from the pure classifier.
 *
 * `recoverable` carries the full capability struct (UI-facing). `dropped`
 * captures the reason a record was excluded — useful for tests and diagnostics.
 */
export type RecoveryClassification =
    | {readonly kind: 'recoverable'; readonly record: RecoverableAgentSession}
    | {readonly kind: 'dropped'; readonly reason: DroppedReason; readonly metadataPath: string}

export type DroppedReason =
    | 'invalid'         // metadata file is malformed or missing required fields
    | 'foreign-vault'   // tmux session name's namespace hash doesn't match current vault
