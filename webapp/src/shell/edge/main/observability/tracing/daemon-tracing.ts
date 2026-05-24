/**
 * Named-tracer accessor for the electron-side graph-daemon lifecycle.
 *
 * The actual NodeTracerProvider registration and owner-diagnostic→span
 * bridge both live in `@vt/observability` (registered from `main.ts`).
 * This module only exposes `daemonTracer()` so call sites in
 * `lifecycle/graph-daemon.ts` and `lifecycle/graph-daemon-recovery.ts`
 * can start spans under the `vt-electron-daemon` tracer name without
 * each importing `@opentelemetry/api` directly.
 */

import { trace, type Tracer } from '@opentelemetry/api'

const TRACER_NAME = 'vt-electron-daemon'

/**
 * Tracer accessor. Safe to call before `tracing.init` runs in main.ts —
 * the OTel API returns a no-op tracer until the provider is registered.
 */
export function daemonTracer(): Tracer {
  return trace.getTracer(TRACER_NAME)
}
