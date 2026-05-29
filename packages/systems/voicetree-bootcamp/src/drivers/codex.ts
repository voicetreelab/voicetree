/**
 * Codex CLI harness driver.
 *
 * Pure parseCodexStream interprets the `codex exec --json` NDJSON; impure
 * runScenario delegates to runHarnessProcess to spawn `codex exec`, capture
 * stdout to a transcript file, and fold in driver-measured wall-clock time.
 *
 * Token strategy (per bootcamp-impl-runner-telemetry, Codex section):
 * sum `turn.completed.usage.{input_tokens, cached_input_tokens,
 * output_tokens, reasoning_output_tokens}` across every settled turn.
 * If the stream ends on `turn.failed`, include its partial usage too —
 * the partial billing is real and we want an honest measurement for the
 * scoring gates to penalise rather than a zero that pretends nothing
 * happened.
 *
 * Formula (harness-symmetric with Claude):
 *     inputTokens  = Σ (input_tokens + cached_input_tokens)
 *     outputTokens = Σ (output_tokens + reasoning_output_tokens)
 *
 * Tool-call counting: dedupe `item.*` events whose `item.type` is
 * `command_execution` or `mcp_tool_call` by `item.id` — `item.started`
 * and `item.completed` share the same id, so a naive count would double.
 * The subtype set is documented but not empirically confirmed; the plan
 * flags this for refinement after the first real-Codex integration run
 * (see bootcamp-impl-driver-interface.md, "Still open").
 *
 * `lastTurnSettled` is true iff the stream ended cleanly: at least one
 * `turn.completed` event was seen AND no `turn.failed` event followed it.
 */
import {join} from 'node:path'
import type {HarnessDriver, RunTelemetry} from '../types.ts'
import {runHarnessProcess} from './_harnessProcess.ts'

type CodexUsage = {
    input_tokens?: number
    cached_input_tokens?: number
    output_tokens?: number
    reasoning_output_tokens?: number
}

type TurnCompletedEvent = {
    type: 'turn.completed'
    usage?: CodexUsage
}

type TurnFailedEvent = {
    type: 'turn.failed'
    usage?: CodexUsage
}

type ItemEvent = {
    type: string  // 'item.started' | 'item.completed' | 'item.failed' | ...
    item: {
        id?: string
        type?: string  // 'command_execution' | 'mcp_tool_call' | 'assistant_message' | ...
    }
}

export type ParseResult = {
    readonly telemetry: Omit<RunTelemetry, 'vtInvocationCount'>
    readonly lastTurnSettled: boolean
}

const TOOL_CALL_ITEM_TYPES: ReadonlySet<string> = new Set([
    'command_execution',
    'mcp_tool_call',
])

/**
 * Parse a Codex `codex exec --json` NDJSON stream into settled telemetry.
 * Pure: takes the raw stdout text, returns counts. wallClockMs is 0 here —
 * the impure runScenario shell measures it (spawn → close) and overwrites
 * it before returning.
 */
export function parseCodexStream(ndjson: string): ParseResult {
    let inputTokens = 0
    let outputTokens = 0
    let sawTurnCompleted = false
    let sawTurnFailed = false
    const toolCallIds = new Set<string>()
    // For tool calls without an id (defensive): count each item.* event with
    // a tool-call subtype, but only the *started* event so completed/failed
    // pairs don't double the count.
    let unidentifiedToolCalls = 0

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
        const eventType = parsed.type
        if (typeof eventType !== 'string') continue

        if (eventType === 'turn.completed' && isTurnEvent(parsed)) {
            sawTurnCompleted = true
            addUsage(parsed.usage)
        } else if (eventType === 'turn.failed' && isTurnEvent(parsed)) {
            sawTurnFailed = true
            addUsage(parsed.usage)
        } else if (eventType.startsWith('item.') && isItemEvent(parsed)) {
            const subtype = parsed.item.type
            if (subtype && TOOL_CALL_ITEM_TYPES.has(subtype)) {
                const id = parsed.item.id
                if (id) {
                    toolCallIds.add(id)
                } else if (eventType === 'item.started') {
                    unidentifiedToolCalls++
                }
            }
        }
    }

    function addUsage(u: CodexUsage | undefined): void {
        if (!u) return
        inputTokens += (u.input_tokens ?? 0) + (u.cached_input_tokens ?? 0)
        outputTokens += (u.output_tokens ?? 0) + (u.reasoning_output_tokens ?? 0)
    }

    const toolCallCount = toolCallIds.size + unidentifiedToolCalls
    const lastTurnSettled = sawTurnCompleted && !sawTurnFailed

    return {
        telemetry: {inputTokens, outputTokens, toolCallCount, wallClockMs: 0},
        lastTurnSettled,
    }
}

function isObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null
}

function isTurnEvent(v: Record<string, unknown>): v is TurnCompletedEvent | TurnFailedEvent {
    return v.usage === undefined || isObject(v.usage)
}

function isItemEvent(v: Record<string, unknown>): v is ItemEvent {
    return isObject(v.item)
}

export const codexDriver: HarnessDriver = {
    name: 'codex',
    // Only one Codex model exposed through this driver for v1. Subsequent
    // SKU variants land when the effort knob is wired (see TODO below).
    models: ['codex-1'],
    runScenario: (opts) => {
        const finalMessagePath = join(opts.artifactDir, 'final-message.txt')

        // TODO: effort knob → model SKU swap; needs probe of
        // ~/.codex/config.toml or codex doctor before integration.
        // For now we pass `opts.model` through verbatim and ignore
        // `opts.effort` at spawn time.
        return runHarnessProcess(opts, {
            command: 'codex',
            args: [
                'exec',
                '--json',
                '--model',
                opts.model,
                '--cd',
                opts.cwd,
                '--skip-git-repo-check',
                '--ephemeral',
                '-a',
                'never',
                '-s',
                'danger-full-access',
                '-o',
                finalMessagePath,
                '--',
                opts.prompt,
            ],
            parse: parseCodexStream,
        })
    },
}
