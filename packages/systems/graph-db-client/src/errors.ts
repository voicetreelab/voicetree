/**
 * Errors raised by the graph-db client. The four daemon-lifecycle error
 * shapes (DaemonLaunchTimeout, OwnerSpawnCooldownError, OwnerWaitTimeoutError,
 * UnsafeOwnerError) come from `@vt/daemon-lifecycle` so the same shapes
 * surface for both vt-graphd and (BF-373) vt-daemon ensure paths. The
 * client-specific HTTP/transport errors (GraphDbClientError, ProjectNotOpenError,
 * ProjectOpenFailedError, DaemonUnreachableError, DaemonLockHeldError) stay
 * here because they describe the graph-db wire protocol, not the lifecycle.
 */

export {
  DaemonLaunchTimeout,
  OwnerSpawnCooldownError,
  OwnerWaitTimeoutError,
  UnsafeOwnerError,
} from '@vt/daemon-lifecycle'

export class GraphDbClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'GraphDbClientError'
  }
}

export class ProjectNotOpenError extends GraphDbClientError {
  constructor(message: string) {
    super(409, 'project_not_open', message)
    this.name = 'ProjectNotOpenError'
  }
}

export class ProjectOpenFailedError extends GraphDbClientError {
  constructor(message: string) {
    super(409, 'project_open_failed', message)
    this.name = 'ProjectOpenFailedError'
  }
}

export class DaemonUnreachableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DaemonUnreachableError'
  }
}

/**
 * A graphd RPC was reachable but did not answer within its deadline, so the
 * in-flight request was aborted. Distinct from {@link DaemonUnreachableError}
 * (connection refused / no listener): here the socket was accepted but the
 * response stalled. Without this bound a stalled RPC hangs the caller's
 * `await` forever — e.g. `openProject` never settling, which leaves the
 * renderer's "loading workspace" spinner spinning until a manual refresh.
 */
export class GraphDbRequestTimeoutError extends Error {
  constructor(
    public readonly method: string,
    public readonly route: string,
    public readonly timeoutMs: number,
  ) {
    super(`vt-graphd request ${method} ${route} exceeded ${timeoutMs}ms and was aborted`)
    this.name = 'GraphDbRequestTimeoutError'
  }
}

export class DaemonLockHeldError extends Error {
  constructor(
    public readonly project: string,
    public readonly pid: number,
  ) {
    super(
      `vt-graphd lock for project ${project} held by unresponsive process pid ${pid}`,
    )
    this.name = 'DaemonLockHeldError'
  }
}
