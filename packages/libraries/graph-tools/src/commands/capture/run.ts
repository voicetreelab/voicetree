import { registerCommand } from '../index'
import { runImplementation } from './run/implementation'
import type { RunTypes } from './run/types'

export type RunResult = RunTypes['RunResult']

registerCommand('run', runImplementation.runHandler)
