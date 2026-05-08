import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { statSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import {
  DaemonLaunchTimeout,
  DaemonLockHeldError,
  DaemonUnreachableError,
} from './errors.ts'
import { discoverPort, readPortFile } from './portDiscovery.ts'

const ALREADY_RUNNING_RE = /vt-graphd:\s+already running for [^\n(]+\(pid (\d+)\)/
const REUSE_PROBE_AFTER_LOCK_HELD_MS = 2000

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

export interface OrphanCleanupResult {
  readonly killed: readonly { pid: number; vault: string }[]
  readonly skipped: readonly { pid: number; vault: string; reason: string }[]
}

/**
 * Find vt-graphd processes whose --vault argument no longer points to an
 * existing directory and terminate them. These are leftover daemons from
 * crashed apps or aborted test runs; they hold ports and contend with the
 * fresh daemon a current load is trying to reach.
 *
 * Only matches daemons launched via the bundled `vt-graphd.ts` entry; only
 * kills processes whose vault path is missing on disk. POSIX-only (macOS,
 * Linux); no-op on other platforms.
 */
function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ESRCH') return false
    if (code === 'EPERM') return true
    return false
  }
}

function readPidCommandLine(pid: number): string | null {
  if (process.platform !== 'darwin' && process.platform !== 'linux') return null
  const result = spawnSync('ps', ['-p', String(pid), '-o', 'command='], {
    encoding: 'utf8',
    timeout: 2000,
  })
  if (result.status !== 0 || !result.stdout) return null
  return result.stdout.trim()
}

/**
 * True when pid's command-line is a `vt-graphd.ts` invocation whose `--vault`
 * argument resolves to `vault`. Used as a safety check before SIGTERM-ing a
 * pid recovered from a lockfile we don't trust.
 */
export function isVtGraphdProcessForVault(pid: number, vault: string): boolean {
  const cmd = readPidCommandLine(pid)
  if (!cmd) return false
  const match = /\bvt-graphd\.ts\b.*--vault\s+(\S+)/.exec(cmd)
  if (!match) return false
  return resolve(match[1]) === resolve(vault)
}

function delay(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms))
}

/**
 * Terminate a vt-graphd process holding the lock for a vault and clean up its
 * stale lock + port files. Refuses to kill a pid whose command-line doesn't
 * match `vt-graphd.ts ... --vault <vault>` — the lockfile contents are
 * untrusted, so we verify before killing.
 *
 * Returns true when the process was terminated (or already dead) and lock /
 * port files were removed; false if the safety check rejected the pid.
 */
export async function terminateUnresponsiveDaemon(
  vault: string,
  pid: number,
  opts?: { gracePeriodMs?: number },
): Promise<boolean> {
  const resolvedVault = resolve(vault)
  const gracePeriodMs = opts?.gracePeriodMs ?? 2000

  if (isProcessAlive(pid) && !isVtGraphdProcessForVault(pid, resolvedVault)) {
    return false
  }

  if (isProcessAlive(pid)) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // already gone
    }

    const deadline = Date.now() + gracePeriodMs
    while (Date.now() < deadline && isProcessAlive(pid)) {
      await delay(50)
    }

    if (isProcessAlive(pid)) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // already gone
      }
      await delay(100)
    }
  }

  const dotDir = join(resolvedVault, '.voicetree')
  await unlink(join(dotDir, 'graphd.lock')).catch(() => undefined)
  await unlink(join(dotDir, 'graphd.port')).catch(() => undefined)
  return true
}

export function killOrphanVtGraphdDaemons(): OrphanCleanupResult {
  const killed: { pid: number; vault: string }[] = []
  const skipped: { pid: number; vault: string; reason: string }[] = []

  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    return { killed, skipped }
  }

  const result = spawnSync('ps', ['-A', '-o', 'pid=,command='], {
    encoding: 'utf8',
    timeout: 5000,
  })
  if (result.status !== 0 || !result.stdout) {
    return { killed, skipped }
  }

  const matcher = /^\s*(\d+)\s+(.*\bvt-graphd\.ts\b.*--vault\s+(\S+).*)$/

  for (const line of result.stdout.split('\n')) {
    const match = matcher.exec(line)
    if (!match) continue
    const pid = Number(match[1])
    const vault = match[3]
    if (!Number.isFinite(pid) || pid === process.pid) continue

    let vaultExists = false
    try {
      vaultExists = statSync(vault).isDirectory()
    } catch {
      vaultExists = false
    }

    if (vaultExists) {
      skipped.push({ pid, vault, reason: 'vault-exists' })
      continue
    }

    try {
      process.kill(pid, 'SIGTERM')
      killed.push({ pid, vault })
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'kill-failed'
      skipped.push({ pid, vault, reason })
    }
  }

  return { killed, skipped }
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
  let alreadyRunningPid: number | null = null
  child.on('error', (err) => {
    spawnError = err as NodeJS.ErrnoException
  })
  child.stderr?.on('data', (chunk: Buffer | string) => {
    stderr = `${stderr}${chunk.toString()}`
    if (stderr.length > 4000) {
      stderr = stderr.slice(-4000)
    }
    if (alreadyRunningPid === null) {
      const match = ALREADY_RUNNING_RE.exec(stderr)
      if (match) alreadyRunningPid = Number(match[1])
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

    // The spawned child detected the lock was already held and exited via
    // process.exit(0). Continuing to wait timeoutMs for a port file from a
    // dead child is pointless. Give the lock-holder one more reuse probe
    // (in case it's slow rather than dead), then surface a typed error so
    // the caller can recover by killing the orphan.
    if (alreadyRunningPid !== null) {
      const reuseDeadline = Date.now() + REUSE_PROBE_AFTER_LOCK_HELD_MS
      while (Date.now() < reuseDeadline) {
        const p = await readPortFile(resolvedVault)
        if (p !== null && (await probeHealth(resolvedVault, p))) {
          return { port: p, pid: alreadyRunningPid, launched: false }
        }
        await sleep(100)
      }
      throw new DaemonLockHeldError(resolvedVault, alreadyRunningPid)
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
