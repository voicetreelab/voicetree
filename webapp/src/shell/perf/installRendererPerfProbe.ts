/**
 * Edge starter that wires {@link startRendererPerfProbe} to the live browser
 * environment: the IPC flush, the cytoscape accessor, and the clocks. This is
 * the only renderer-perf file that touches `window` directly — impurity at the
 * edge.
 *
 * Called once from the renderer entry (`main.tsx`), gated on
 * `window.voicetreeEnv.perfProbe`, so the probe and its rAF loop never run in
 * the normal app — only under the e2e-nav-storm harness (`VOICETREE_PERF_PROBE=1`).
 */
import type { Core } from 'cytoscape'
import { startRendererPerfProbe } from '@/shell/perf/rendererPerfProbe'
import type { RendererTelemetryBatch } from '@/shell/perf/rendererTelemetryContract'

type TelemetrySink = {
    main?: { recordRendererTelemetry?: (batch: RendererTelemetryBatch) => Promise<void> }
}

/**
 * Install the renderer perf probe when perf-probe mode is on. Idempotent: a
 * second call returns the already-installed probe. Returns undefined (and does
 * nothing) when the gate is off.
 */
export function installRendererPerfProbe(): void {
    if (window.voicetreeEnv?.perfProbe !== true) return
    if (window.__vtPerfProbe__) return

    const flush = async (batch: RendererTelemetryBatch): Promise<void> => {
        const api = (window as unknown as { electronAPI?: TelemetrySink }).electronAPI
        await api?.main?.recordRendererTelemetry?.(batch)
    }

    const probe = startRendererPerfProbe({
        flush,
        getCy: () => (window as unknown as { cytoscapeInstance?: Core }).cytoscapeInstance,
        nowMonotonic: () => performance.now(),
        nowEpoch: () => Date.now(),
    })

    window.__vtPerfProbe__ = probe
}
