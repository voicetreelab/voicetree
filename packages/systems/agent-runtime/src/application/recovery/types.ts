import type {TerminalData, TerminalId} from '../terminals/terminal-registry/types'
import type {UnclaimedTmuxSession} from '../terminals/tmux/unclaimed-tmux'

/**
 * Capability struct for a single known terminal record.
 *
 * Each record can independently expose zero, one, or both of two action
 * capabilities:
 *
 * - `attach`: a live tmux pane exists under this terminal id → Attach button
 *   (re-grabs the orphaned pane).
 *
 * - `resume`: a transcript matching this terminal id was found on disk by the
 *   Claude/Codex resolver → Resume button (spawns a fresh process with
 *   `--resume <sessionId>`, continuing the conversation). Resolved at discovery
 *   time, not pre-captured.
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
    readonly nativeSessionId: string
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
