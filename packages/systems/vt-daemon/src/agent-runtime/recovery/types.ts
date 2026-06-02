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
 *   can be resumed → Resume button. If the terminal JSON already has
 *   `recovery.native.sessionId`, discovery carries that exact id through;
 *   otherwise the expensive provider lookup is deferred to the resume/fork
 *   action and persisted if it succeeds.
 *
 * `isClaimed` reports whether the terminal id is in the live in-memory
 * registry. UI decides where to render: claimed rows render in the regular
 * terminal tab strip; unclaimed rows render in the Surviving Agents section.
 *
 * Records with neither capability and no in-memory presence are filtered out
 * upstream by discovery (nothing the UI could do with them).
 *
 * Row context fields (`worktreeName`, `title`, `agentTypeName`) mirror what
 * live terminal tiles render — surfacing them on Surviving Agents rows lets
 * users identify a recoverable agent at a glance instead of seeing only the
 * raw terminal id.
 *
 * Lifecycle fields (`status`, `startedAt`, `endedAt`, `closedAt`, `killReason`)
 * carry the on-disk lifecycle state. `status` is `'running'` for a still-live
 * record (whether or not the tmux pane is alive — that's the `attach`
 * capability's job), and `'exited'` / `'killed'` once the agent has stopped.
 * `closedAt` is the parsed ms epoch of `endedAt` and exists to keep sorting
 * and the recency-horizon filter O(1) without re-parsing on every comparison.
 */
export type RecoverableAgentSession = {
    readonly terminalId: TerminalId
    readonly agentName: string
    readonly metadataPath: string
    readonly terminalData: TerminalData
    readonly isClaimed: boolean
    readonly attach?: AttachCapability
    readonly resume?: ResumeCapability
    readonly status: 'running' | 'exited' | 'killed'
    readonly worktreeName?: string
    readonly title?: string
    readonly agentTypeName?: string
    readonly startedAt?: string
    readonly endedAt?: string
    readonly closedAt?: number
    readonly killReason?: string
}

export type AttachCapability = {
    readonly session: UnclaimedTmuxSession
}

export type ResumeCapability = {
    readonly cliType: 'claude' | 'codex'
    readonly nativeSessionId?: string
    readonly providerStorePath?: string
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
    | 'foreign-project'   // tmux session name's namespace hash doesn't match current project
