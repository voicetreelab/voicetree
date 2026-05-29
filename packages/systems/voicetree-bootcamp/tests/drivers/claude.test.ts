import {readFile} from 'node:fs/promises'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'
import {parseClaudeStream} from '../../src/drivers/claude.ts'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

async function loadFixture(name: string): Promise<string> {
    return await readFile(join(FIXTURES, name), 'utf8')
}

describe('parseClaudeStream', () => {
    it('settles tokens from the result line (real Haiku 4.5 probe)', async () => {
        const ndjson = await loadFixture('claude-haiku-success.jsonl')
        const {telemetry, resultLineFound} = parseClaudeStream(ndjson)

        // 10 (input) + 31450 (cache_creation) + 0 (cache_read) = 31460
        expect(telemetry.inputTokens).toBe(31460)
        expect(telemetry.outputTokens).toBe(44)
        expect(telemetry.toolCallCount).toBe(0)
        expect(resultLineFound).toBe(true)
    })

    it('does not double-count multi-block messages (uses result, not per-event sum)', async () => {
        const ndjson = await loadFixture('claude-haiku-success.jsonl')
        const {telemetry} = parseClaudeStream(ndjson)

        // The fixture has two assistant events for one message.id, each
        // reporting usage.output_tokens=3. A naive per-event sum would be 6,
        // and 6+44 from result would be 50. The settled result.usage value
        // is 44 (thinking + text payload billed across the turn).
        expect(telemetry.outputTokens).not.toBe(6)
        expect(telemetry.outputTokens).not.toBe(50)
        expect(telemetry.outputTokens).toBe(44)
    })

    it('falls back to deduped-by-message.id sum when no result line is emitted', async () => {
        const ndjson = await loadFixture('claude-killed-midrun.jsonl')
        const {telemetry, resultLineFound} = parseClaudeStream(ndjson)

        // msg_A: 3 events, output_tokens=5 each → contributes 5 (deduped).
        // msg_B: 2 events, output_tokens=10 each → contributes 10 (deduped).
        // Total: 15. A naive sum would be 5*3 + 10*2 = 35.
        expect(telemetry.outputTokens).toBe(15)
        expect(telemetry.outputTokens).not.toBe(35)
        expect(resultLineFound).toBe(false)
    })

    it('counts toolCallCount deduped by (message.id, content[].id)', async () => {
        const ndjson = await loadFixture('claude-tool-dedupe.jsonl')
        const {telemetry} = parseClaudeStream(ndjson)

        // Three assistant events repeat the same content block list,
        // containing one tool_use (id=tool_1). After dedupe → 1, not 3.
        expect(telemetry.toolCallCount).toBe(1)
    })

    it('returns zero counts on empty input', () => {
        const {telemetry, resultLineFound} = parseClaudeStream('')
        expect(telemetry.inputTokens).toBe(0)
        expect(telemetry.outputTokens).toBe(0)
        expect(telemetry.toolCallCount).toBe(0)
        expect(resultLineFound).toBe(false)
    })

    it('skips malformed lines without throwing', () => {
        const ndjson = ['not json', '{"type":"system"}', '{broken'].join('\n')
        expect(() => parseClaudeStream(ndjson)).not.toThrow()
    })
})
