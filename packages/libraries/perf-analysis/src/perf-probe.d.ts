export type PerfTier = 'off' | 'lite' | 'deep'

export type PerfProbePlan =
  | { tier: 'off' }
  | { tier: 'lite' | 'deep'; wallSamplingMicros: number; heapSnapshots: boolean }

export function perfProbePlan(env?: NodeJS.ProcessEnv): PerfProbePlan

export function startPerfProbe(options: {
  svc: string
  plan: PerfProbePlan
  env?: NodeJS.ProcessEnv
}): Promise<undefined | (() => Promise<void>)>

export function scheduleHeapSnapshots(options: {
  heapSnapshotsDir: string
  svc: string
  offsetsMs?: readonly number[]
  writeSnapshot?: (path: string) => void
  schedule?: (cb: () => void, ms: number) => unknown
  onError?: (message: string) => void
}): { stop(): void }

export function perfProbeFromEnv(
  svc: string,
  env?: NodeJS.ProcessEnv,
): Promise<undefined | (() => Promise<void>)>
