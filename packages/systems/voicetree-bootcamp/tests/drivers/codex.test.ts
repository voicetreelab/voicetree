import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'
import {parseCodexStream} from '../../src/drivers/codex.ts'

const fixturesDir = join(fileURLToPath(new URL('./fixtures', import.meta.url)))

function loadFixture(name: string): string {
    return readFileSync(join(fixturesDir, name), 'utf8')
}

describe('parseCodexStream', () => {
    it('parses a single-turn success: settled telemetry sums usage exactly', () => {
        const ndjson = loadFixture('codex-synthetic-success.jsonl')
        const {telemetry, lastTurnSettled} = parseCodexStream(ndjson)

        // input_tokens(1200) + cached_input_tokens(3400) = 4600
        expect(telemetry.inputTokens).toBe(4600)
        // output_tokens(450) + reasoning_output_tokens(80) = 530
        expect(telemetry.outputTokens).toBe(530)
        // items 1 and 2 are command_execution (deduped via item.id); item 3
        // is assistant_message and must not count.
        expect(telemetry.toolCallCount).toBe(2)
        expect(telemetry.wallClockMs).toBe(0)
        expect(lastTurnSettled).toBe(true)
    })

    it('sums usage across multiple turn.completed events', () => {
        const ndjson = loadFixture('codex-synthetic-multiturn.jsonl')
        const {telemetry, lastTurnSettled} = parseCodexStream(ndjson)

        // input + cached per turn: (1000+500) + (1500+2000) + (800+1100)
        // = 1500 + 3500 + 1900 = 6900
        expect(telemetry.inputTokens).toBe(6900)
        // output + reasoning per turn: (200+50) + (300+120) + (150+30)
        // = 250 + 420 + 180 = 850
        expect(telemetry.outputTokens).toBe(850)
        // 1 command_execution + 1 mcp_tool_call + 1 command_execution = 3
        expect(telemetry.toolCallCount).toBe(3)
        expect(lastTurnSettled).toBe(true)
    })

    it('preserves partial usage and marks lastTurnSettled=false on turn.failed', () => {
        const ndjson = loadFixture('codex-synthetic-failed.jsonl')
        const {telemetry, lastTurnSettled} = parseCodexStream(ndjson)

        // Sum across the one turn.completed plus the partial turn.failed:
        //   completed: input(900)+cached(400) = 1300; output(180)+reason(40) = 220
        //   failed:    input(600)+cached(300) =  900; output( 50)+reason(10) =  60
        // Totals: input=2200, output=280
        expect(telemetry.inputTokens).toBe(2200)
        expect(telemetry.outputTokens).toBe(280)
        // Both items are command_execution (one with completed pair, one
        // started-only). Deduped via item.id -> 2 tool calls.
        expect(telemetry.toolCallCount).toBe(2)
        expect(lastTurnSettled).toBe(false)
    })

    it('counts command_execution and mcp_tool_call items, ignores other item.* subtypes', () => {
        const ndjson = [
            JSON.stringify({type: 'session.created', session_id: 'mixed'}),
            // Tool call subtypes — should count once each (deduped by id).
            JSON.stringify({type: 'item.started', item: {id: 'a', type: 'command_execution'}}),
            JSON.stringify({type: 'item.completed', item: {id: 'a', type: 'command_execution'}}),
            JSON.stringify({type: 'item.started', item: {id: 'b', type: 'mcp_tool_call'}}),
            JSON.stringify({type: 'item.completed', item: {id: 'b', type: 'mcp_tool_call'}}),
            // Non-tool subtypes — should be ignored.
            JSON.stringify({type: 'item.started', item: {id: 'c', type: 'assistant_message'}}),
            JSON.stringify({type: 'item.completed', item: {id: 'c', type: 'assistant_message'}}),
            JSON.stringify({type: 'item.started', item: {id: 'd', type: 'reasoning'}}),
            JSON.stringify({type: 'item.completed', item: {id: 'd', type: 'reasoning'}}),
            JSON.stringify({type: 'item.started', item: {id: 'e', type: 'file_change'}}),
            // Required so lastTurnSettled is true and telemetry shape is valid.
            JSON.stringify({type: 'turn.completed', usage: {input_tokens: 1, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0}}),
        ].join('\n')

        const {telemetry} = parseCodexStream(ndjson)
        expect(telemetry.toolCallCount).toBe(2)
    })

    it('returns zeroed telemetry and lastTurnSettled=false on empty input', () => {
        const {telemetry, lastTurnSettled} = parseCodexStream('')
        expect(telemetry).toEqual({inputTokens: 0, outputTokens: 0, toolCallCount: 0, wallClockMs: 0})
        expect(lastTurnSettled).toBe(false)
    })

    it('skips malformed and non-JSON lines (including fixture header comments)', () => {
        const ndjson = [
            '// SYNTHETIC FIXTURE — header comment line',
            '',
            'not json at all',
            JSON.stringify({type: 'turn.completed', usage: {input_tokens: 100, cached_input_tokens: 0, output_tokens: 50, reasoning_output_tokens: 0}}),
            '{"truncated":',
        ].join('\n')
        const {telemetry, lastTurnSettled} = parseCodexStream(ndjson)
        expect(telemetry.inputTokens).toBe(100)
        expect(telemetry.outputTokens).toBe(50)
        expect(lastTurnSettled).toBe(true)
    })
})
