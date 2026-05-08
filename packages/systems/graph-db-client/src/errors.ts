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
