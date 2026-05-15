import { configureAgentRuntime, getRuntimeUI } from '../runtime/runtime-config'
import {agentRuntimeApiWorkflow} from '../application/workflows/agentRuntimeApi.ts'

export const agentRuntime = agentRuntimeApiWorkflow({
    configureAgentRuntime,
    getRuntimeUI,
})
