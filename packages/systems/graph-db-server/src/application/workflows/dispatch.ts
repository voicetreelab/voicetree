import type { State } from '@vt/graph-state'
import {
  runCommand,
  type Command,
  type CommandOutput,
} from '../core/runCommand.ts'
import { buildDaemonState } from '../session/buildDaemonState.ts'
import { jsonResult, notFoundResult, type HttpResult } from './httpResult.ts'
import type { WorkflowSessionRegistry } from './session/sessionRoutes.ts'

type Session = ReturnType<WorkflowSessionRegistry['getOrCreate']>

type DispatchResult<R> = {
  readonly session?: Session
  readonly commands: readonly Command[]
  readonly response: R
}

type CommandRunner = <C extends Command>(
  command: C,
  registry?: WorkflowSessionRegistry,
) => Promise<CommandOutput[C['type']]>

export async function executeCommand<C extends Command>(
  command: C,
  registry?: WorkflowSessionRegistry,
): Promise<CommandOutput[C['type']]> {
  return await runCommand(command, registry ? { registry } : {})
}

export async function executeCommands(
  commands: readonly Command[],
  registry?: WorkflowSessionRegistry,
  commandRunner: CommandRunner = executeCommand,
): Promise<void> {
  for (const command of commands) {
    await commandRunner(command, registry)
  }
}

export async function dispatch<B, R>(
  registry: WorkflowSessionRegistry,
  sessionId: string,
  body: B,
  handler: (session: Session, body: B) => DispatchResult<R> | Promise<DispatchResult<R>>,
): Promise<HttpResult> {
  const session = registry.get(sessionId)
  if (!session) {
    return notFoundResult()
  }

  const result = await handler(session, body)
  if (result.session) {
    Object.assign(session, result.session)
  }
  await executeCommands(result.commands, registry)
  return jsonResult(result.response)
}

export async function dispatchOrCreateWithState<B, R>(
  registry: WorkflowSessionRegistry,
  sessionId: string,
  body: B,
  handler: (
    session: Session,
    state: State,
    body: B,
  ) => DispatchResult<R> | Promise<DispatchResult<R>>,
): Promise<HttpResult> {
  const session = registry.getOrCreate(sessionId)
  const state = await buildDaemonState(session)
  const result = await handler(session, state, body)
  if (result.session) {
    Object.assign(session, result.session)
  }
  await executeCommands(result.commands, registry)
  return jsonResult(result.response)
}
