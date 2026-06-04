/**
 * VoiceTree session-recovery markers — the single source of truth shared by the
 * Claude transcript matcher and the Codex thread matcher.
 *
 * Recovery fingerprints an orphaned agent's native session by the identifying
 * env-var lines the spawn prompt echoes verbatim into the agent's first user
 * message (the `<YOUR_ENV_VARS>` block of prompts/AGENT_PROMPT_CORE.md and
 * AGENT_PROMPT_LIGHTWEIGHT.md). A transcript matches only when it contains ALL
 * THREE marker lines for the requested terminal.
 *
 * This list is a LOAD-BEARING CONTRACT with those prompt templates: if a
 * template stops echoing any one of these keys, every resume silently fails
 * with a `marker-mismatch`. `prompt-template-recovery-markers.contract.test.ts`
 * guards the contract by asserting each shipped template still prints every key.
 */
export const RECOVERY_MARKER_KEYS = [
    'VOICETREE_TERMINAL_ID',
    'VOICETREE_PROJECT_PATH',
    'TASK_NODE_PATH',
] as const

export type RecoveryMarkerKey = typeof RECOVERY_MARKER_KEYS[number]

export type RecoveryMarkerValues = {
    readonly terminalId: string
    readonly projectRoot: string
    readonly taskNodePath: string
}

function markerValue(key: RecoveryMarkerKey, values: RecoveryMarkerValues): string {
    switch (key) {
        case 'VOICETREE_TERMINAL_ID':
            return values.terminalId
        case 'VOICETREE_PROJECT_PATH':
            return values.projectRoot
        case 'TASK_NODE_PATH':
            return values.taskNodePath
    }
}

/** The `KEY = VALUE` env line the prompt echoes for one marker key. */
export function recoveryMarkerLine(key: RecoveryMarkerKey, values: RecoveryMarkerValues): string {
    return `${key} = ${markerValue(key, values)}`
}

/**
 * True iff `text` (a transcript's first user message) contains every VoiceTree
 * recovery marker line for the given identity. Empty text never matches.
 */
export function textContainsAllRecoveryMarkers(text: string, values: RecoveryMarkerValues): boolean {
    if (!text) return false
    return RECOVERY_MARKER_KEYS.every((key) => text.includes(recoveryMarkerLine(key, values)))
}
