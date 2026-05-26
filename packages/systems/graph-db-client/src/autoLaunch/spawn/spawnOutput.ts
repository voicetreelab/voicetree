const ALREADY_RUNNING_RE = /vt-graphd:\s+already running for [^\n(]+\(pid (\d+)\)/

export function boundedAppend(
  current: string,
  chunk: Buffer | string,
  maxLength: number,
): string {
  const next = `${current}${chunk.toString()}`
  return next.length > maxLength ? next.slice(-maxLength) : next
}

export function parseAlreadyRunningPid(stderr: string): number | null {
  const match = ALREADY_RUNNING_RE.exec(stderr)
  return match ? Number(match[1]) : null
}

export function launchTimeoutMessage(
  timeoutMs: number,
  resolvedVault: string,
  stderr: string,
): string {
  const stderrSuffix = stderr.trim()
    ? `\nvt-graphd stderr:\n${stderr.trim()}`
    : ''
  return `vt-graphd did not become ready within ${timeoutMs}ms for vault ${resolvedVault}${stderrSuffix}`
}
