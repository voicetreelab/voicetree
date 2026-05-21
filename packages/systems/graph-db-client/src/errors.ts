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

export class DaemonLaunchTimeout extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DaemonLaunchTimeout'
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
