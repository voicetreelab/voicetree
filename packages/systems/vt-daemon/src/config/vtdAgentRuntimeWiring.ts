// vtd's agent-runtime wiring helpers, extracted from `bin/vtd.ts` to keep the
// daemon entrypoint within the file-size budget. Two cohesive concerns:
//   - configureAgentRuntimeForVtd: resolve the `vt` bin dir from the CLI
//     package dir and hand the agent-runtime its env + publish + graph wiring.
//   - buildPublishTerminalRegistryEvent: the single publish sink that fans a
//     terminal-registry event onto the SSE topic AND the in-process
//     completion-monitor side channel.
//
// `resolveVoicetreeCliPackageDir` deliberately stays in `bin/vtd.ts`: it is
// `import.meta.url`-relative and must resolve against the binary's on-disk
// location, so the caller passes the already-resolved dir in here.

import {existsSync} from 'node:fs'
import type {TerminalRegistryEvent} from '@vt/vt-daemon-protocol'
import {registerChildIfMonitored} from '../agent-runtime/agent-control/agent-completion-monitor.ts'
import {configureAgentRuntime, type GraphStateBridge} from '../agent-runtime/runtime/runtime-config.ts'
import {resolveVtBinDir} from '../agent-runtime/spawn/injection/vtPathInjection.ts'

/**
 * Configure the agent-runtime for a VTD process. `voicetreeCliPackageDir` is
 * the resolved `@voicetree/cli` package dir; `vt` lives at
 * `<voicetree-cli>/bin/vt`. `resolveVtBinDir` verifies the script exists and
 * returns null otherwise — the spawn pipeline's PATH injection then no-ops
 * gracefully. The CLI manual is rendered live from @vt/vt-daemon-protocol's
 * TOOL_SPECS, so vtd no longer needs to register a manual path.
 */
export function configureAgentRuntimeForVtd(
    voicetreeCliPackageDir: string,
    publishTerminalRegistryEvent: (event: TerminalRegistryEvent) => void,
    graph: GraphStateBridge,
): void {
    const vtBinDir: string | null = resolveVtBinDir(voicetreeCliPackageDir, existsSync)

    configureAgentRuntime({
        env: {
            getVtBinDir: (): string | null => vtBinDir,
        },
        publishTerminalRegistryEvent,
        graph,
    })
}

/**
 * Build the publish sink injected into agent-runtime. Two concerns fan out
 * from a single event:
 *
 *   1. Wire publish onto the new `terminal-registry` SSE topic so renderer
 *      clients learn about registry mutations and the imperative UI-launch
 *      instructions that used to fire as in-process UI callbacks.
 *   2. In-process side effect for `terminal-ui-child-registered`: VTD owns
 *      the agent-completion monitor (`registerChildIfMonitored`); when a spawn
 *      announces a new child of a monitored parent, the monitor's terminal-id
 *      table must learn about it before the child's first poll. Pre-S2-R this
 *      happened through an in-process callback; that callback is gone, so we
 *      route the same data through the publish sink instead.
 *
 * The sink is the canonical place to do both because it sits at the boundary
 * where every event passes through exactly once.
 */
export function buildPublishTerminalRegistryEvent(
    publishOnTopic: (event: string, data: unknown) => void,
): (event: TerminalRegistryEvent) => void {
    return (event: TerminalRegistryEvent): void => {
        publishOnTopic(event.type, event)
        if (event.type === 'terminal-ui-child-registered') {
            registerChildIfMonitored(event.parentTerminalId, event.childTerminalId)
        }
    }
}
