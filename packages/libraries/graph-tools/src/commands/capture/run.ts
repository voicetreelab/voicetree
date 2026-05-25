import { registerCommand } from '../index'
import { runImplementation } from './run/implementation'

export const createStateCaptureOverlay = runImplementation.createStateCaptureOverlay
export const applyDeltaToStateCaptureOverlay = runImplementation.applyDeltaToStateCaptureOverlay
export const buildCapturedSerializedState = runImplementation.buildCapturedSerializedState

export type StateCaptureOverlay = Parameters<
  typeof runImplementation.applyDeltaToStateCaptureOverlay
>[0]
type OkResponseResult<T> = T extends { ok: true; result: infer Result } ? Result : never

export type RunResult = OkResponseResult<Awaited<ReturnType<typeof runImplementation.runHandler>>>
export type RunStepOutput = RunResult['bundle']['outputs'][number]

registerCommand('run', runImplementation.runHandler)
