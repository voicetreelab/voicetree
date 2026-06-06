/**
 * Agent status-declaration telemetry.
 *
 * Records every agent-declared status transition (the `AgentStatusPreset` set
 * when an agent records a progress node via `create_graph`) with timestamp and
 * agent type, into both an in-memory ring buffer (10k events) for live
 * snapshots and an optional sink (the JSONL file at VOICETREE_HOME/
 * lifecycle-telemetry.jsonl).
 *
 * Useful for spotting regressions: if a supported agent stops declaring status
 * (e.g. a prompt-template change drops the instruction), the snapshot will
 * show zero events for that agent type.
 */

import {AGENT_STATUS_PRESETS, type AgentStatusPreset} from '@vt/vt-daemon-protocol'

export type TierEventKind = AgentStatusPreset

export type TierEvent = {
    readonly ts: number
    readonly terminalId: string
    readonly agentTypeName: string
    readonly kind: TierEventKind
}

export type AgentBreakdown = {
    readonly count: number
    readonly byKind: Readonly<Record<TierEventKind, number>>
}

export type TelemetrySnapshot = {
    readonly totalEvents: number
    readonly byKind: Readonly<Record<TierEventKind, number>>
    readonly byAgent: Readonly<Record<string, AgentBreakdown>>
    /** ISO timestamp of the earliest event in the snapshot (or null if empty). */
    readonly firstEventAt: string | null
    /** ISO timestamp of the latest event. */
    readonly lastEventAt: string | null
}

function emptyByKind(): Record<TierEventKind, number> {
    return Object.fromEntries(
        AGENT_STATUS_PRESETS.map((preset: AgentStatusPreset) => [preset, 0]),
    ) as Record<TierEventKind, number>
}

function bumpAgentBreakdown(
    existing: AgentBreakdown | undefined,
    kind: TierEventKind,
): AgentBreakdown {
    const base: AgentBreakdown = existing ?? {count: 0, byKind: emptyByKind()}
    return {
        count: base.count + 1,
        byKind: {...base.byKind, [kind]: base.byKind[kind] + 1},
    }
}

/**
 * Pure aggregation: take a list of recorded events, return the snapshot.
 * No I/O, no time source — same input → same output.
 */
export function computeTelemetrySnapshot(events: readonly TierEvent[]): TelemetrySnapshot {
    const byKind: Record<TierEventKind, number> = emptyByKind()
    const byAgent: Record<string, AgentBreakdown> = {}
    let minTs: number | null = null
    let maxTs: number | null = null

    for (const event of events) {
        byKind[event.kind]++
        const agentKey: string = event.agentTypeName || '(unknown)'
        byAgent[agentKey] = bumpAgentBreakdown(byAgent[agentKey], event.kind)

        if (minTs === null || event.ts < minTs) minTs = event.ts
        if (maxTs === null || event.ts > maxTs) maxTs = event.ts
    }

    return {
        totalEvents: events.length,
        byKind,
        byAgent,
        firstEventAt: minTs === null ? null : new Date(minTs).toISOString(),
        lastEventAt: maxTs === null ? null : new Date(maxTs).toISOString(),
    }
}

// =============================================================================
// Edge: in-memory ring buffer + optional sink
// =============================================================================

const RING_CAPACITY: number = 10_000

type TelemetrySink = (event: TierEvent) => void

const state: {events: TierEvent[]; sink: TelemetrySink | null} = {
    events: [],
    sink: null,
}

/**
 * Append an event to the in-memory ring. Oldest events are dropped past
 * RING_CAPACITY. Also forwards to the configured sink (file/remote) if any.
 * Hot path — must be fast and never throw. The sink is wrapped in try/catch.
 */
export function recordTierEvent(event: TierEvent): void {
    if (state.events.length >= RING_CAPACITY) {
        state.events.shift()
    }
    state.events.push(event)
    if (state.sink) {
        try {
            state.sink(event)
        } catch {
            // Telemetry must not break the hot path.
        }
    }
}

/**
 * Read the current snapshot. Pure aggregation over the current ring buffer.
 */
export function getTierTelemetrySnapshot(): TelemetrySnapshot {
    return computeTelemetrySnapshot(state.events)
}

/**
 * Configure a sink that receives every recorded event (in addition to the
 * in-memory ring). Pass null to clear. Used to wire up the JSONL file
 * writer in production; tests can use a custom sink for assertions.
 */
export function configureTelemetrySink(sink: TelemetrySink | null): void {
    state.sink = sink
}

/** Test-only escape hatch. */
export function __clearTierTelemetryForTests(): void {
    state.events.length = 0
    state.sink = null
}
