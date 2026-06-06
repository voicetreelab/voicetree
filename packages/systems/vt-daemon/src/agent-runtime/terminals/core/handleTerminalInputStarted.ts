import {MAX_STATUS_PHRASE_LENGTH, type TerminalRecordPatch} from '@vt/vt-daemon-protocol'
import type {TerminalRecord} from '../domain/session.ts'

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

export function deriveTerminalInputStarted(
    record: TerminalRecord,
    inputText: string,
): TerminalInputStartedResult {
    if (record.status === 'exited') {
        return {changed: false, patches: [], record}
    }

    const nextPhrase: string = statusPhraseFromTerminalInput(inputText)
    const nextRecord: TerminalRecord = {
        ...record,
        terminalData: {
            ...record.terminalData,
            lifecycle: 'active',
            isDone: false,
            lastReportedStatus: null,
            statusPhrase: nextPhrase,
        },
    }

    const patches: TerminalRecordPatch[] = []
    if (record.terminalData.isDone !== false) {
        patches.push({kind: 'done', value: false})
    }
    if (record.terminalData.lifecycle !== 'active') {
        patches.push({kind: 'lifecycle', value: 'active'})
    }
    if (record.terminalData.statusPhrase !== nextPhrase) {
        patches.push({kind: 'statusPhrase', value: nextPhrase})
    }

    const changed: boolean =
        patches.length > 0 ||
        record.terminalData.lastReportedStatus !== null

    return {changed, patches, record: changed ? nextRecord : record}
}
