/**
 * Black-box tests for the JSONL file sink edge helper.
 *
 * Drives the real recordTierEvent + sink wiring with an in-memory fs dep —
 * no mocks of the telemetry module itself.
 */

import {describe, it, expect, beforeEach} from 'vitest'
import {recordTierEvent, __clearTierTelemetryForTests, type TierEvent} from '../tierTelemetry'
import {installJsonlTelemetrySink, type JsonlSinkDeps} from '../tierTelemetryJsonlSink'

function makeFs(): {deps: JsonlSinkDeps; files: Map<string, string>; mkdirCalls: string[]} {
    const files: Map<string, string> = new Map()
    const mkdirCalls: string[] = []
    return {
        files,
        mkdirCalls,
        deps: {
            appendFile: (filePath: string, line: string): void => {
                files.set(filePath, (files.get(filePath) ?? '') + line)
            },
            mkdirSync: (dir: string): void => {
                mkdirCalls.push(dir)
            },
        },
    }
}

function evt(over: Partial<TierEvent> & {kind: TierEvent['kind']}): TierEvent {
    return {
        ts: 1_000_000,
        terminalId: 'cc-1',
        agentTypeName: 'Claude',
        kind: over.kind,
        ...over,
    }
}

describe('installJsonlTelemetrySink', () => {
    beforeEach(() => __clearTierTelemetryForTests())

    it('creates the containing directory on install', () => {
        const fs = makeFs()
        installJsonlTelemetrySink('/test/app/lifecycle-telemetry.jsonl', fs.deps)
        expect(fs.mkdirCalls).toEqual(['/test/app'])
    })

    it('appends one JSON line per recorded event', () => {
        const fs = makeFs()
        installJsonlTelemetrySink('/test/app/log.jsonl', fs.deps)
        recordTierEvent(evt({kind: 'awaiting_input', ts: 1}))
        recordTierEvent(evt({kind: 'working', ts: 2}))
        const contents: string = fs.files.get('/test/app/log.jsonl') ?? ''
        const lines: string[] = contents.split('\n').filter(Boolean)
        expect(lines).toHaveLength(2)
        expect(JSON.parse(lines[0])).toMatchObject({kind: 'awaiting_input', ts: 1})
        expect(JSON.parse(lines[1])).toMatchObject({kind: 'working', ts: 2})
    })

    it('uninstall stops writing further events', () => {
        const fs = makeFs()
        const uninstall = installJsonlTelemetrySink('/test/app/log.jsonl', fs.deps)
        recordTierEvent(evt({kind: 'awaiting_input'}))
        uninstall()
        recordTierEvent(evt({kind: 'working'}))
        const lines: string[] = (fs.files.get('/test/app/log.jsonl') ?? '').split('\n').filter(Boolean)
        expect(lines).toHaveLength(1)
    })
})
