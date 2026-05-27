export type V8CpuProfileToPprofSummary = {
  startedAtMs: number
  stoppedAtMs: number
  durationNanos: string
  sampleCount: number
  totalValueNanos: string
  functionCount: number
}

export type ConvertV8CpuProfileToPprofOptions = {
  startedAtMs?: number
  stoppedAtMs?: number
}

export function convertV8CpuProfileToPprof(
  profile: unknown,
  options?: ConvertV8CpuProfileToPprofOptions,
): {
  pprofBuffer: Uint8Array
  summary: V8CpuProfileToPprofSummary
}
