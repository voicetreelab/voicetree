import type {TerminalData, TerminalId} from '../terminals/terminal-registry/types'
import type {UnclaimedTmuxSession} from '../terminals/tmux/unclaimed-tmux'

/**
 * UI/runtime type for actionable recovery candidates.
 * Returned by the discovery function (Phase 2c) and consumed by the runtime resume action and sidebar.
 *
 * Discriminated by `kind`:
 * - `attachable-tmux`: live unclaimed tmux pane exists → Attach action
 * - `resumable-cli`: pane is gone but provider native session handle exists → Resume action
 */
export type RecoverableAgentSession =
    | {
        readonly kind: 'attachable-tmux'
        readonly session: UnclaimedTmuxSession
    }
    | {
        readonly kind: 'resumable-cli'
        readonly terminalId: TerminalId
        readonly agentName: string
        readonly cliType: 'claude' | 'codex'
        readonly metadataPath: string
        readonly terminalData: TerminalData
        readonly nativeSessionId: string
        readonly reason: 'missing-tmux-session'
    }

/**
 * Per-record output from the pure classifier.
 * Covers all classification outcomes including non-actionable ones (for diagnostics and tests).
 *
 * Actionable kinds: `attachable-live-tmux`, `resumable-missing-tmux`
 * Non-actionable kinds: `missing-native-handle`, `exited`, `claimed`, `foreign-vault`, `unsupported-cli`, `invalid`
 */
export type RecoveryClassification =
    | {
        readonly kind: 'attachable-live-tmux'
        readonly terminalId: TerminalId
        readonly sessionName: string
        readonly metadataPath: string
    }
    | {
        readonly kind: 'resumable-missing-tmux'
        readonly terminalId: TerminalId
        readonly agentName: string
        readonly cliType: 'claude' | 'codex'
        readonly nativeSessionId: string
        readonly metadataPath: string
        readonly terminalData: TerminalData
    }
    | {readonly kind: 'missing-native-handle'; readonly terminalId: TerminalId; readonly metadataPath: string}
    | {readonly kind: 'exited'; readonly terminalId: TerminalId; readonly metadataPath: string}
    | {readonly kind: 'claimed'; readonly terminalId: TerminalId; readonly metadataPath: string}
    | {readonly kind: 'foreign-vault'; readonly terminalId: TerminalId; readonly metadataPath: string}
    | {readonly kind: 'unsupported-cli'; readonly terminalId: TerminalId; readonly metadataPath: string}
    | {readonly kind: 'invalid'; readonly metadataPath: string}
