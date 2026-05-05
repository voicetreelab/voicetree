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

function buildChildEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }

  // When called from Electron, use the Electron binary in Node mode so native
  // modules match the ABI they were rebuilt for by the Electron test/dev flow.
  if (process.versions.electron) {
    env.ELECTRON_RUN_AS_NODE = '1'
  }

  return env
}

function resolveRuntimeCommand(): string {
  return process.execPath
}

function resolveCommand(vault: string, override: string | undefined): CommandSpec {
  const trimmed = override?.trim()
  if (trimmed) {
    const parts = trimmed.split(/\s+/)
    const [cmd, ...rest] = parts
    return { cmd, args: [...rest, '--vault', vault] }
  }
  return {
    cmd: resolveRuntimeCommand(),
    args: ['--import', TSX_IMPORT_PATH, FALLBACK_BIN_PATH, '--vault', vault],
    env: buildChildEnv(),
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
    stdio: 'ignore',
  })
  child.unref()
  const spawnedPid = child.pid ?? null

  let spawnError: NodeJS.ErrnoException | null = null
  child.on('error', (err) => {
    spawnError = err as NodeJS.ErrnoException
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
  throw new DaemonLaunchTimeout(
    `vt-graphd did not become ready within ${timeoutMs}ms for vault ${resolvedVault}`,
  )
}
