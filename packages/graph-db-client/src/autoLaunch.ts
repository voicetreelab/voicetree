import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { DaemonLaunchTimeout, DaemonUnreachableError } from './errors.ts'
import { discoverPort, readPortFile } from './portDiscovery.ts'

const requireFromHere = createRequire(import.meta.url)
const TSX_IMPORT_PATH = requireFromHere.resolve('tsx')
const GRAPH_DB_SERVER_ENTRYPOINT = requireFromHere.resolve('@vt/graph-db-server')

// Resolve from the installed workspace package, not from import.meta.url.
// In the bundled Electron main process, import.meta.url points into dist output.
const FALLBACK_BIN_PATH = resolve(
  dirname(GRAPH_DB_SERVER_ENTRYPOINT),
  '../bin/vt-graphd.ts',
)

export interface EnsureDaemonResult {
  port: number
  pid: number | null
  launched: boolean
}

type CommandSpec = { cmd: string; args: string[]; env?: NodeJS.ProcessEnv }
type RuntimeVersions = NodeJS.ProcessVersions & { electron?: string }
type RuntimeCommandInput = {
  env?: NodeJS.ProcessEnv
  execPath?: string
  versions?: Partial<RuntimeVersions>
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function probeHealth(vault: string, port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`)
    if (!response.ok) {
      return false
    }

    const body: unknown = await response.json()
    if (!isRecord(body) || typeof body.vault !== 'string') {
      return false
    }

    return body.vault === resolve(vault)
  } catch {
    return false
  }
}

export function resolveDaemonRuntimeCommand(
  input: RuntimeCommandInput = {},
): string {
  const env = input.env ?? process.env
  const versions = input.versions ?? process.versions

  // Inside Electron we deliberately default to Electron's own binary running
  // as Node (with ELECTRON_RUN_AS_NODE=1; see resolveDaemonRuntimeEnv). That
  // way the daemon's native modules — notably better-sqlite3 — match the
  // ABI that @electron/rebuild compiled them for. Using the system `node`
  // here is the historical bug: when the user's system Node version doesn't
  // match Electron's bundled Node ABI, the daemon throws
  // "NODE_MODULE_VERSION mismatch" and never becomes ready.
  //
  // Explicit overrides still win: VT_GRAPHD_NODE_BIN is the documented
  // escape hatch for users who really do want a specific Node binary.
  if (versions.electron) {
    return env.VT_GRAPHD_NODE_BIN?.trim() || (input.execPath ?? process.execPath)
  }

  return input.execPath ?? process.execPath
}

/**
 * Env additions to merge into the daemon's spawn environment.
 *
 * When we're spawning Electron's binary as Node, we must set
 * `ELECTRON_RUN_AS_NODE=1` or the binary launches as Electron and tries to
 * open a window. This function returns the minimal env mutations needed for
 * the chosen runtime; it is intentionally additive (caller spreads it on top
 * of process.env).
 */
export function resolveDaemonRuntimeEnv(
  input: RuntimeCommandInput = {},
): NodeJS.ProcessEnv {
  const env = input.env ?? process.env
  const versions = input.versions ?? process.versions

  // Only relevant inside Electron, and only when no explicit override is set
  // (an explicit override points at a real Node binary, not Electron).
  if (versions.electron && !env.VT_GRAPHD_NODE_BIN?.trim()) {
    return { ELECTRON_RUN_AS_NODE: '1' }
  }
  return {}
}

function resolveCommand(vault: string, override: string | undefined): CommandSpec {
  const trimmed = override?.trim()
  if (trimmed) {
    const parts = trimmed.split(/\s+/)
    const [cmd, ...rest] = parts
    return { cmd, args: [...rest, '--vault', vault] }
  }
  return {
    cmd: resolveDaemonRuntimeCommand(),
    args: ['--import', TSX_IMPORT_PATH, FALLBACK_BIN_PATH, '--vault', vault],
    env: { ...process.env, ...resolveDaemonRuntimeEnv() },
  }
}

export async function ensureDaemon(
  vault: string,
  opts?: { timeoutMs?: number; bin?: string },
): Promise<EnsureDaemonResult> {
  const resolvedVault = resolve(vault)
  const timeoutMs = opts?.timeoutMs ?? 5000

  // 1. Reuse path: short-wait for existing port file, then /health-verify.
  let existingPort: number | null = null
  try {
    existingPort = await discoverPort(resolvedVault, { timeoutMs: 500 })
  } catch (err) {
    if (!(err instanceof DaemonUnreachableError)) throw err
  }
  if (
    existingPort !== null &&
    (await probeHealth(resolvedVault, existingPort))
  ) {
    return { port: existingPort, pid: null, launched: false }
  }

  // 2. Spawn detached + unref'd. Propagate sync spawn errors (EACCES/EPERM).
  const { cmd, args, env } = resolveCommand(
    resolvedVault,
    process.env.VT_GRAPHD_BIN ?? opts?.bin,
  )
  let child: ChildProcess = spawn(cmd, args, {
    detached: true,
    env,
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  child.unref()
  child.stderr?.unref?.()
  const spawnedPid = child.pid ?? null

  let spawnError: NodeJS.ErrnoException | null = null
  let stderr = ''
  child.on('error', (err) => {
    spawnError = err as NodeJS.ErrnoException
  })
  child.stderr?.on('data', (chunk: Buffer | string) => {
    stderr = `${stderr}${chunk.toString()}`
    if (stderr.length > 4000) {
      stderr = stderr.slice(-4000)
    }
  })

  // 3. Poll for port file + /health (lock-coalesces: whoever's port file lands first wins).
  const deadline = Date.now() + timeoutMs
  let backoff = 50
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError

    const port = await readPortFile(resolvedVault)
    if (port !== null && (await probeHealth(resolvedVault, port))) {
      return { port, pid: spawnedPid, launched: true }
    }

    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    await sleep(Math.min(backoff, remaining))
    backoff = Math.min(backoff * 2, 500)
  }

  if (spawnError) throw spawnError
  const stderrSuffix = stderr.trim()
    ? `\nvt-graphd stderr:\n${stderr.trim()}`
    : ''
  throw new DaemonLaunchTimeout(
    `vt-graphd did not become ready within ${timeoutMs}ms for vault ${resolvedVault}${stderrSuffix}`,
  )
}
