import {MAX_STATUS_PHRASE_LENGTH, type TerminalRecordPatch} from '@vt/vt-daemon-protocol'
import type {TerminalRecord} from '../domain/session.ts'

/**
 * How long an agent-authored status phrase is protected from being overwritten
 * by text typed into (or injected into) the terminal. Within this window the
 * carefully-written phrase wins; only once it is older than this does typed
 * input replace it. Keeps a human glancing at the tree from seeing a status the
 * agent just wrote get clobbered the instant someone resumes the terminal.
 */
export const STATUS_PHRASE_OVERRIDE_STALENESS_MS = 5 * 60_000

export type TerminalInputStartedResult = {
    readonly changed: boolean
    readonly patches: readonly TerminalRecordPatch[]
    readonly record: TerminalRecord
}

export function statusPhraseFromTerminalInput(inputText: string): string {
    return inputText
        .replace(/[^\p{L}]+/gu, ' ')
        .replace(/ {2,}/g, ' ')
        .trim()
        .slice(0, MAX_STATUS_PHRASE_LENGTH)
}

// ---------------------------------------------------------------------------
// Typed-line accumulation
//
// A terminal relay forwards raw keystrokes one frame at a time, so a human
// typing "review the PR" then Enter arrives as the frames 'r','e','v',… ,'\r'.
// Updating the status on every frame would leave it showing a single trailing
// character. `advanceTerminalInputLine` buffers those keystrokes and only emits
// a completed line once an Enter (CR/LF) is seen, so the status reflects the
// whole submitted message rather than a mid-typing fragment.
// ---------------------------------------------------------------------------

/**
 * Enter symbols. A human Enter in the renderer's xterm arrives as CR (`\r`);
 * LF (`\n`) covers pasted newlines and alternative line endings. This matches
 * the submit bytes `send-text-to-terminal` writes (`\r`, and `\x1b\r` for
 * Alt+Enter — the `\x1b` is consumed as an ordinary, non-Enter character here).
 */
const ENTER_CHARS: ReadonlySet<string> = new Set(['\r', '\n'])
/** DEL (`\x7f`) and BS (`\x08`) — so an in-line correction edits the buffer. */
const BACKSPACE_CHARS: ReadonlySet<string> = new Set(['\x7f', '\x08'])

export type TerminalInputLineBuffer = {readonly pending: string}

export const EMPTY_TERMINAL_INPUT_LINE_BUFFER: TerminalInputLineBuffer = {pending: ''}

export type TerminalInputLineStep = {
    /** Buffer carried to the next frame (text typed after the last Enter). */
    readonly buffer: TerminalInputLineBuffer
    /**
     * The completed line to treat as a submission, or `null` if this frame
     * contained no Enter and we are still accumulating. Empty string is a valid
     * submission (a bare Enter) — distinct from `null`.
     */
    readonly submitted: string | null
}

export function advanceTerminalInputLine(
    buffer: TerminalInputLineBuffer,
    payload: string,
): TerminalInputLineStep {
    let pending: string = buffer.pending
    const completed: string[] = []
    for (const ch of payload) {
        if (ENTER_CHARS.has(ch)) {
            completed.push(pending)
            pending = ''
        } else if (BACKSPACE_CHARS.has(ch)) {
            pending = pending.slice(0, -1)
        } else {
            pending += ch
        }
    }
    if (completed.length === 0) {
        return {buffer: {pending}, submitted: null}
    }
    return {buffer: {pending}, submitted: completed.join(' ')}
}

export function deriveTerminalInputStarted(
    record: TerminalRecord,
    inputText: string,
    nowMs: number,
): TerminalInputStartedResult {
    if (record.status === 'exited') {
        return {changed: false, patches: [], record}
    }

    // Typed input always reactivates the turn — the agent is being resumed, so
    // it is no longer done and re-enters `active`, clearing any preset it
    // declared on the previous turn. This is independent of whether we also
    // adopt the input as the new status phrase.
    //
    // The phrase, by contrast, is only overwritten when the existing one is
    // "spent": empty (never set), or older than the staleness window. A phrase
    // the agent wrote moments ago is left untouched so a resume does not erase
    // it. A blank derived phrase (input with no letters) never overwrites.
    const existingPhrase: string = record.terminalData.statusPhrase
    const phraseIsStale: boolean =
        existingPhrase === '' ||
        nowMs - record.terminalData.statusPhraseUpdatedAt >= STATUS_PHRASE_OVERRIDE_STALENESS_MS
    const candidatePhrase: string = statusPhraseFromTerminalInput(inputText)
    const overridePhrase: boolean = phraseIsStale && candidatePhrase.length > 0
    const nextPhrase: string = overridePhrase ? candidatePhrase : existingPhrase

    const nextRecord: TerminalRecord = {
        ...record,
        terminalData: {
            ...record.terminalData,
            lifecycle: 'active',
            isDone: false,
            lastReportedStatus: null,
            statusPhrase: nextPhrase,
            statusPhraseUpdatedAt: overridePhrase ? nowMs : record.terminalData.statusPhraseUpdatedAt,
        },
    }

    const patches: TerminalRecordPatch[] = []
    if (record.terminalData.isDone !== false) {
        patches.push({kind: 'done', value: false})
    }
    if (record.terminalData.lifecycle !== 'active') {
        patches.push({kind: 'lifecycle', value: 'active'})
    }
    if (overridePhrase && nextPhrase !== existingPhrase) {
        patches.push({kind: 'statusPhrase', value: nextPhrase})
    }

    const changed: boolean =
        patches.length > 0 ||
        record.terminalData.lastReportedStatus !== null

    return {changed, patches, record: changed ? nextRecord : record}
}
