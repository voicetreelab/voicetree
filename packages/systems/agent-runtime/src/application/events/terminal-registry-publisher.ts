/**
 * Transport-agnostic publisher for the `terminal-registry` SSE topic.
 *
 * Agent-runtime mutations (`recordTerminalSpawn`, `removeTerminalFromRegistry`,
 * `updateTerminalPinned`/`Minimized`/`ActivityState`/`IsDone`) and the launch
 * call sites that used to fire `getRuntimeUI().launchTerminalOntoUI` /
 * `registerChildIfMonitored` all emit through this single sink. VTD wires the
 * real SSE publisher at boot via `configureAgentRuntime`; tests inject a
 * capturing array; unit tests that do not care receive the no-op default.
 *
 * Deep narrow function — a single `(event) => void`, not a class, not an
 * EventEmitter, not an observer object. Receivers exhaustively switch on
 * `event.type` (see `TerminalRegistryEvent` in `@vt/vt-daemon-protocol`).
 */

import type {TerminalRegistryEvent} from '@vt/vt-daemon-protocol'

export type PublishTerminalRegistryEvent = (event: TerminalRegistryEvent) => void

const noopPublish: PublishTerminalRegistryEvent = (): void => {}

let publish: PublishTerminalRegistryEvent = noopPublish

export function setPublishTerminalRegistryEvent(fn: PublishTerminalRegistryEvent | undefined): void {
    publish = fn ?? noopPublish
}

export function publishTerminalRegistryEvent(event: TerminalRegistryEvent): void {
    publish(event)
}
