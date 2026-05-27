/**
 * Errors raised by the graph-db client. The four daemon-lifecycle error
 * shapes (DaemonLaunchTimeout, OwnerSpawnCooldownError, OwnerWaitTimeoutError,
 * UnsafeOwnerError) come from `@vt/daemon-lifecycle` so the same shapes
 * surface for both vt-graphd and (BF-373) vt-daemon ensure paths. The
 * client-specific HTTP/transport errors (GraphDbClientError, VaultNotOpenError,
 * VaultOpenFailedError, DaemonUnreachableError, DaemonLockHeldError) stay
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

export class VaultNotOpenError extends GraphDbClientError {
  constructor(message: string) {
    super(409, 'vault_not_open', message)
    this.name = 'VaultNotOpenError'
  }
}

export class VaultOpenFailedError extends GraphDbClientError {
  constructor(message: string) {
    super(409, 'vault_open_failed', message)
    this.name = 'VaultOpenFailedError'
  }
}

export class DaemonUnreachableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DaemonUnreachableError'
  }
}

export class DaemonLockHeldError extends Error {
  constructor(
    public readonly vault: string,
    public readonly pid: number,
  ) {
    super(
      `vt-graphd lock for vault ${vault} held by unresponsive process pid ${pid}`,
    )
    this.name = 'DaemonLockHeldError'
  }
}
