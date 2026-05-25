import { registerCommand } from '../index'
import { runImplementation } from './run/implementation'

registerCommand('run', runImplementation.runHandler)
