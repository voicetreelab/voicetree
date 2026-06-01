export type StructuredProjectErrorCode = 'project_not_open' | 'project_open_failed'

export class StructuredProjectError extends Error {
  readonly status = 409

  constructor(
    public readonly code: StructuredProjectErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'StructuredProjectError'
  }

  toResponseBody(): { error: { code: StructuredProjectErrorCode; message: string } } {
    return { error: { code: this.code, message: this.message } }
  }
}

export class ProjectNotOpenError extends StructuredProjectError {
  constructor(message = 'A project must be opened before using this endpoint') {
    super('project_not_open', message)
    this.name = 'ProjectNotOpenError'
  }
}

export class ProjectOpenFailedError extends StructuredProjectError {
  constructor(message = 'Failed to open project') {
    super('project_open_failed', message)
    this.name = 'ProjectOpenFailedError'
  }
}

export function structuredProjectErrorResult(
  error: StructuredProjectError,
): { readonly kind: 'json'; readonly body: unknown; readonly status: number } {
  return { kind: 'json', body: error.toResponseBody(), status: error.status }
}
