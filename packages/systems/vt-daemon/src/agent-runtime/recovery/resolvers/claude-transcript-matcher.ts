import {textContainsAllRecoveryMarkers} from './recovery-markers'

export type ClaudeContentBlock = {
    readonly type?: string
    readonly text?: string
}

export type ClaudeTranscriptRecord = {
    readonly sessionId?: string
    readonly type?: string
    readonly message?: {
        readonly role?: string
        readonly content?: string | ReadonlyArray<ClaudeContentBlock>
    }
}

export type ClaudeMatchInput = {
    readonly records: readonly ClaudeTranscriptRecord[]
    readonly terminalId: string
    readonly projectRoot: string
    readonly taskNodePath: string
}

function extractMessageText(record: ClaudeTranscriptRecord): string {
    const content = record.message?.content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
        let acc: string = ''
        for (const block of content) {
            if (block && typeof block.text === 'string') {
                acc += `\n${block.text}`
            }
        }
        return acc
    }
    return ''
}

function recordMatchesMarkers(
    record: ClaudeTranscriptRecord,
    terminalId: string,
    projectRoot: string,
    taskNodePath: string,
): boolean {
    return textContainsAllRecoveryMarkers(extractMessageText(record), {terminalId, projectRoot, taskNodePath})
}

/**
 * Pure first-match resolver for Claude transcript records.
 *
 * Returns the `sessionId` of the first record whose `message.content` contains
 * all three VoiceTree markers (terminal id, project path, task node path).
 * Returns null when no record matches or the matching record has no sessionId.
 *
 * Handles both string content and array-of-blocks content. Malformed records
 * (missing fields, non-string text) are silently skipped — they cannot match
 * but they do not throw.
 */
export function matchClaudeSessionId(input: ClaudeMatchInput): string | null {
    for (const record of input.records) {
        if (!record || typeof record !== 'object') continue
        if (!recordMatchesMarkers(record, input.terminalId, input.projectRoot, input.taskNodePath)) continue
        const sessionId: string | undefined = record.sessionId
        if (typeof sessionId === 'string' && sessionId.length > 0) return sessionId
    }
    return null
}
