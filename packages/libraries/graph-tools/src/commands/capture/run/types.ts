export type RunTypes = {
  RunStepOutput: {
    step: unknown
    ok: boolean
    error?: string
    observationErrors?: string[]
    screenshot?: string
    console?: string
    drift?: string
    state?: string
  }
  RunResult: {
    source: string
    bundle: {
      dir: string
      stepCount: number
      outputs: RunTypes['RunStepOutput'][]
    }
  }
}
