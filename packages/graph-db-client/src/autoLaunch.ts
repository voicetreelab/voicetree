import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
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
type RuntimeValidation = { ok: true } | { ok: false; reason: string }

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function unrefIfSupported(value: unknown): void {
  if (!isRecord(value) || typeof value.unref !== 'function') return
  value.unref()
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
  const candidates = daemonRuntimeCandidates({
    env,
    execPath: input.execPath ?? process.execPath,
    versions: input.versions ?? process.versions,
  })
  const failures: string[] = []

  for (const candidate of candidates) {
    const validation = validateDaemonRuntime(candidate, env)
    if (validation.ok) {
      return candidate
    }
    failures.push(`${candidate}: ${validation.reason}`)
  }

  throw new Error(
    `Could not find a Node runtime for vt-graphd that supports node:sqlite. Checked: ${failures.join('; ')}`,
  )
}

function daemonRuntimeCandidates(input: Required<RuntimeCommandInput>): string[] {
  const candidates = [
    input.env.VT_GRAPHD_NODE_BIN,
    input.env.npm_node_execpath,
    input.execPath,
    input.versions.electron ? undefined : process.execPath,
    'node',
  ]

  return uniqueNonEmpty(candidates)
}

function uniqueNonEmpty(values: Array<string | undefined>): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const value of values) {
    const trimmed = value?.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
  }

  return result
}

function validateDaemonRuntime(
  candidate: string,
  env: NodeJS.ProcessEnv,
): RuntimeValidation {
  const result = spawnSync(
    candidate,
    [
      '-e',
      [
        'if (process.versions.electron) {',
        "  throw new Error(`Electron runtime ABI ${process.versions.modules} cannot host vt-graphd`)",
        '}',
        "const { DatabaseSync } = require('node:sqlite')",
        "new DatabaseSync(':memory:').close()",
      ].join('\n'),
    ],
    {
      encoding: 'utf8',
      env,
      timeout: 5000,
    },
  )

  if (result.status === 0) {
    return { ok: true }
  }

  if (result.error) {
    return { ok: false, reason: result.error.message }
  }

  const stderr = result.stderr.trim()
  const stdout = result.stdout.trim()
  const detail = stderr || stdout || `exit status ${result.status ?? 'unknown'}`
  return { ok: false, reason: detail.split('\n').at(-1) ?? detail }
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
    env: { ...process.env },
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
  unrefIfSupported(child.stderr)
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
