import {
  AddReadPathRequestSchema,
  SetWriteFolderPathRequestSchema,
} from '@vt/graph-db-server/contract'
import { validateAbsolutePath } from '@vt/graph-db-server/application/core/validatePath'
import {
  ProjectNotOpenError,
  structuredProjectErrorResult,
} from '@vt/graph-db-server/application/errors/projectNotOpen'
import {
  classifyAddReadPathResult,
  classifyRemoveReadPathResult,
  classifySetWriteFolderPathResult,
  composeReadPathsResponse,
  composeWriteFolderPathResponse,
  decodeProjectPath,
} from '@vt/graph-db-server/application/core/handleProject'
import { executeCommand } from '../dispatch.ts'
import { errorResult, jsonResult, type HttpResult } from '../httpResult.ts'
import { awaitProjectOpenReady } from '../projectOpenGate.ts'

// Upper bound for how long a project-scoped read may wait on an in-flight
// `openProjectWorkflow` before falling through to the existing 409 path. Picked
// well above any expected open latency (folder scan + sync wiring is ~hundreds
// of ms in practice) while still leaving the renderer's overall RPC budget
// intact if the daemon genuinely stalls.
const PROJECT_OPEN_READY_TIMEOUT_MS = 5000

export async function readProjectWorkflow(): Promise<HttpResult> {
  try {
    await awaitProjectOpenReady(PROJECT_OPEN_READY_TIMEOUT_MS)
    return jsonResult(await executeCommand({ type: 'ReadProjectState' }))
  } catch (error) {
    if (error instanceof ProjectNotOpenError) {
      return structuredProjectErrorResult(error)
    }
    return errorResult(
      (error as Error).message,
      'PROJECT_STATE_READ_FAILED',
      500,
    )
  }
}

export async function addReadPathWorkflow(rawBody: unknown): Promise<HttpResult> {
  const body = AddReadPathRequestSchema.safeParse(rawBody)
  if (!body.success) {
    return errorResult('Invalid request body', 'INVALID_REQUEST_BODY')
  }

  const validatedPath = await validateAbsolutePath(body.data.path, {
    requireExists: true,
  })
  if (!validatedPath.ok) {
    return errorResult(validatedPath.error, validatedPath.code)
  }

  const result = await executeCommand({
    type: 'AddProjectReadPath',
    path: validatedPath.path,
  })
  const classification = classifyAddReadPathResult(result)
  if (classification.kind === 'error') {
    return errorResult(
      classification.message,
      classification.code,
      classification.status,
    )
  }

  const projectState = await executeCommand({ type: 'ReadProjectState' })
  return jsonResult(composeReadPathsResponse(projectState.readPaths))
}

export async function removeReadPathWorkflow(
  encodedPath: string,
): Promise<HttpResult> {
  const decodedPath = decodeProjectPath(encodedPath)
  if (!decodedPath.ok) {
    return errorResult(decodedPath.error, decodedPath.code)
  }

  const validatedPath = await validateAbsolutePath(decodedPath.decoded)
  if (!validatedPath.ok) {
    return errorResult(validatedPath.error, validatedPath.code)
  }

  const result = await executeCommand({
    type: 'RemoveProjectReadPath',
    path: validatedPath.path,
  })
  const classification = classifyRemoveReadPathResult(result)
  if (classification.kind === 'error') {
    return errorResult(
      classification.message,
      classification.code,
      classification.status,
    )
  }

  const projectState = await executeCommand({ type: 'ReadProjectState' })
  return jsonResult(composeReadPathsResponse(projectState.readPaths))
}

export async function setWriteFolderPathWorkflow(rawBody: unknown): Promise<HttpResult> {
  const body = SetWriteFolderPathRequestSchema.safeParse(rawBody)
  if (!body.success) {
    return errorResult('Invalid request body', 'INVALID_REQUEST_BODY')
  }

  const validatedPath = await validateAbsolutePath(body.data.path, {
    requireExists: true,
  })
  if (!validatedPath.ok) {
    return errorResult(validatedPath.error, validatedPath.code)
  }

  const result = await executeCommand({
    type: 'SetProjectWriteFolderPath',
    path: validatedPath.path,
  })
  const classification = classifySetWriteFolderPathResult(result)
  if (classification.kind === 'error') {
    return errorResult(
      classification.message,
      classification.code,
      classification.status,
    )
  }

  return jsonResult(composeWriteFolderPathResponse(validatedPath.path))
}
