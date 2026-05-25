/**
 * Claude Code harness driver.
 *
 * Pure parseClaudeStream interprets the --output-format=stream-json NDJSON;
 * impure runScenario spawns `claude`, captures stdout to a transcript file,
 * and folds in driver-measured wall-clock time.
 *
 * Token strategy (corrected after probe 3): Claude Code emits one
 * type:"assistant" event per content block within a single message.id, and
 * every event carries the SAME message.usage. Naive per-event sums double-
 * count any multi-block turn (thinking + text, text + tool_use, ...). The
 * settled `result.usage` aggregate is authoritative. On SIGKILL with no
 * result line, fall back to deduping assistant events by message.id and
 * summing one entry per unique message.
 */
import {spawn} from 'node:child_process'
import {createWriteStream} from 'node:fs'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import type {Effort, HarnessDriver, RunTelemetry} from '../types.ts'

type Usage = {
    input_tokens?: number
    output_tokens?: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
}

type ContentBlock = {
    type?: string
    id?: string
}

type AssistantEvent = {
    type: 'assistant'
    message: {
        id: string
        usage?: Usage
        content?: readonly ContentBlock[]
    }
}

type ResultEvent = {
    type: 'result'
    usage?: Usage
}

export type ParseResult = {
    readonly telemetry: Omit<RunTelemetry, 'vtInvocationCount'>
    readonly resultLineFound: boolean
}

/**
 * Parse a Claude Code NDJSON stream into settled telemetry. Pure: takes the
 * raw stdout text, returns counts. wallClockMs is 0 here — the impure
 * runScenario shell measures it (spawn → close) and overwrites it.
 */
export function parseClaudeStream(ndjson: string): ParseResult {
    const assistantEvents: AssistantEvent[] = []
    let resultEvent: ResultEvent | undefined

    for (const line of ndjson.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        let parsed: unknown
        try {
            parsed = JSON.parse(trimmed)
        } catch {
            continue
        }
        if (!isObject(parsed)) continue
        if (parsed.type === 'assistant' && isAssistantEvent(parsed)) {
            assistantEvents.push(parsed)
        } else if (parsed.type === 'result' && isResultEvent(parsed)) {
            resultEvent = parsed
        }
    }

    const resultLineFound = resultEvent !== undefined
    const {inputTokens, outputTokens} = resultLineFound
        ? tokensFromResult(resultEvent!)
        : tokensFromAssistantsDeduped(assistantEvents)
    const toolCallCount = countToolUses(assistantEvents)

    return {
        telemetry: {inputTokens, outputTokens, toolCallCount, wallClockMs: 0},
        resultLineFound,
    }
}

function tokensFromResult(result: ResultEvent): {inputTokens: number; outputTokens: number} {
    const u = result.usage ?? {}
    return {
        inputTokens:
            (u.input_tokens ?? 0) +
            (u.cache_creation_input_tokens ?? 0) +
            (u.cache_read_input_tokens ?? 0),
        outputTokens: u.output_tokens ?? 0,
    }
}

function tokensFromAssistantsDeduped(events: readonly AssistantEvent[]): {
    inputTokens: number
    outputTokens: number
} {
    // Same message.id repeats across content-block events with identical
    // usage; counting each event would multiply by the block count.
    const byMessageId = new Map<string, Usage>()
    for (const ev of events) {
        if (!byMessageId.has(ev.message.id) && ev.message.usage) {
            byMessageId.set(ev.message.id, ev.message.usage)
        }
    }
    let inputTokens = 0
    let outputTokens = 0
    for (const u of byMessageId.values()) {
        inputTokens +=
            (u.input_tokens ?? 0) +
            (u.cache_creation_input_tokens ?? 0) +
            (u.cache_read_input_tokens ?? 0)
        outputTokens += u.output_tokens ?? 0
    }
    return {inputTokens, outputTokens}
}

function countToolUses(events: readonly AssistantEvent[]): number {
    // Dedupe by (message.id, content[].id) so a multi-event message doesn't
    // multiply the count when the same content block reappears across events.
    const seen = new Set<string>()
    for (const ev of events) {
        const content = ev.message.content ?? []
        for (const block of content) {
            if (block.type !== 'tool_use') continue
            const blockId = block.id ?? ''
            seen.add(`${ev.message.id}::${blockId}`)
        }
    }
    return seen.size
}

function isObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null
}

function isAssistantEvent(v: Record<string, unknown>): v is AssistantEvent {
    const msg = v.message
    if (!isObject(msg)) return false
    return typeof msg.id === 'string'
}

function isResultEvent(v: Record<string, unknown>): v is ResultEvent {
    return v.usage === undefined || isObject(v.usage)
}

export const claudeCodeDriver: HarnessDriver = {
    name: 'claude',
    models: ['haiku', 'sonnet', 'opus'],
    runScenario: async (opts) => {
        const transcriptPath = join(opts.artifactDir, 'transcript.jsonl')
        const args = [
            '--print',
            '--model',
            opts.model,
            '--effort',
            opts.effort satisfies Effort,
            '--permission-mode',
            'bypassPermissions',
            '--output-format',
            'stream-json',
            '--verbose',
            '--',
            opts.prompt,
        ]

        const start = Date.now()
        const child = spawn('claude', args, {
            cwd: opts.cwd,
            env: {...opts.env},
            stdio: ['ignore', 'pipe', 'pipe'],
        })

        const transcriptStream = createWriteStream(transcriptPath)
        child.stdout.pipe(transcriptStream)
        child.stderr.resume()

        const timeoutHandle = setTimeout(() => {
            child.kill('SIGKILL')
        }, opts.timeoutMs)

        const exitInfo = await new Promise<{
            code: number | null
            signal: NodeJS.Signals | null
        }>((resolve) => {
            child.on('close', (code, signal) => {
                clearTimeout(timeoutHandle)
                resolve({code, signal})
            })
        })

        const wallClockMs = Date.now() - start

        await new Promise<void>((resolve) => {
            if (transcriptStream.closed) resolve()
            else transcriptStream.end(() => resolve())
        })

        const ndjson = await readFile(transcriptPath, 'utf8')
        const {telemetry} = parseClaudeStream(ndjson)

        return {
            transcriptPath,
            telemetry: {...telemetry, wallClockMs},
            exitInfo,
        }
    },
}
