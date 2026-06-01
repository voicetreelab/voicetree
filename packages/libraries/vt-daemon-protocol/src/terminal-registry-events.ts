/**
 * Payload shapes for the new `terminal-registry` SSE topic.
 *
 * Per design decision 2 (BF-376 outbound), registry mutations and the
 * UI-imperative callbacks that `getRuntimeUI()` used to fire (these
 * landed in agent-runtime as direct calls into Main today) move onto a
 * dedicated SSE topic on Leaf B's hub. The `agent-events` envelope is
 * NOT widened — topics stay narrow and homogeneous.
 *
 * Source publishing points inside `@vt/agent-runtime`:
 *
 *   terminal-registered          → `recordTerminalSpawn`
 *                                  (`application/terminals/terminal-registry/spawn.ts`)
 *   terminal-removed             → `removeTerminalFromRegistry`
 *                                  (`application/terminals/terminal-registry/queries.ts`)
 *   terminal-record-changed      → any state mutation that calls
 *                                  `patchTerminalRecord` (`updates.ts` /
 *                                  `lifecycle.ts` after S2-S/S2-R lands)
 *   terminal-ui-launch           → replaces
 *                                  `getRuntimeUI().launchTerminalOntoUI`
 *                                  call sites in `spawnPlainTerminal`,
 *                                  `launchTerminalSpawn`, and
 *                                  `spawnHookTerminal`
 *   terminal-ui-child-registered → replaces
 *                                  `getRuntimeUI().registerChildIfMonitored`
 *                                  call site in `launchTerminalSpawn`
 *
 * `getRuntimeUI().closeTerminalById` does NOT get its own event —
 * receivers derive the close from `terminal-removed` (the renderer
 * already knows the terminal pane it had open; it tears down on remove).
 *
 * Project-switch fence (per Leaf B's main-host-purity §"Project-switch
 * fence") applies identically: envelopes whose `project` does not match
 * `getActiveProject()` are dropped before they reach the renderer. That
 * happens at the Main-side bridge — the protocol shape stays
 * project-agnostic.
 */

import type {NodeIdAndFilePath} from './core-types.ts'
import type {
    TerminalData,
    TerminalId,
    TerminalRecord,
    TerminalRecordPatch,
} from './terminal-types.ts'

/**
 * SSE topic name. Wire-level constant — the daemon's hub
 * (`transport/eventSubscriptionHub.ts`) must add this to its
 * `ALLOWED_TOPICS` list when Stage 2-S lands.
 */
export const TERMINAL_REGISTRY_TOPIC = 'terminal-registry' as const
export type TerminalRegistryTopic = typeof TERMINAL_REGISTRY_TOPIC

// ---------------------------------------------------------------------------
// Event payloads
// ---------------------------------------------------------------------------

/** A new row entered the registry — receivers append it to their cache. */
export interface TerminalRegisteredEvent {
    readonly type: 'terminal-registered'
    readonly record: TerminalRecord
}

/** A registry row was removed — receivers drop the entry (and tear down any UI). */
export interface TerminalRemovedEvent {
    readonly type: 'terminal-removed'
    readonly terminalId: TerminalId
}

/** A field on an existing record changed — receivers apply `patch` in place. */
export interface TerminalRecordChangedEvent {
    readonly type: 'terminal-record-changed'
    readonly terminalId: TerminalId
    readonly patch: TerminalRecordPatch
}

/**
 * Imperative "launch this terminal onto the UI" instruction. Replaces
 * the old `getRuntimeUI().launchTerminalOntoUI(nodeId, terminalData,
 * skipFitAnimation)` callback. The renderer creates the panel, fits
 * the viewport (unless skipped), and starts the WS attach.
 */
export interface TerminalUiLaunchEvent {
    readonly type: 'terminal-ui-launch'
    readonly nodeId: NodeIdAndFilePath
    readonly terminalData: TerminalData
    readonly skipFitAnimation: boolean
}

/**
 * Imperative "the registry now considers this terminal a child of the
 * parent's monitored set" instruction. Replaces the old
 * `getRuntimeUI().registerChildIfMonitored(parentTerminalId, childTerminalId)`
 * callback fired in `launchTerminalSpawn` when a spawn carries a
 * `parentTerminalId`.
 */
export interface TerminalUiChildRegisteredEvent {
    readonly type: 'terminal-ui-child-registered'
    readonly parentTerminalId: TerminalId
    readonly childTerminalId: TerminalId
}

/**
 * Discriminated union of every event the `terminal-registry` topic can
 * carry. Receivers exhaustively switch on `type`.
 */
export type TerminalRegistryEvent =
    | TerminalRegisteredEvent
    | TerminalRemovedEvent
    | TerminalRecordChangedEvent
    | TerminalUiLaunchEvent
    | TerminalUiChildRegisteredEvent

export type TerminalRegistryEventType = TerminalRegistryEvent['type']

/** Canonical event-type ordering for tests / dispatcher tables. */
export const TERMINAL_REGISTRY_EVENT_TYPES: readonly TerminalRegistryEventType[] = [
    'terminal-registered',
    'terminal-removed',
    'terminal-record-changed',
    'terminal-ui-launch',
    'terminal-ui-child-registered',
] as const
