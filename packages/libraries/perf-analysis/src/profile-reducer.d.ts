export type CpuProfileCallFrame = {
  functionName?: string
  url?: string
  lineNumber?: number
}

export type CpuProfileNode = {
  id: number
  callFrame?: CpuProfileCallFrame
}

export type CpuProfile = {
  nodes?: CpuProfileNode[]
  samples?: number[]
  timeDeltas?: number[]
}

export function flattenCpuProfile(
  profile: CpuProfile,
  options?: { includePseudo?: boolean },
): Map<string, number>

export function topK(weights: Map<string, number>, k?: number): Array<[string, number]>
