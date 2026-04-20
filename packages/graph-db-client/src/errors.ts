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
