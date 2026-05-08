import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { trace, SpanStatusCode } from '@opentelemetry/api'
import {
  DaemonLaunchTimeout,
  DaemonLockHeldError,
  DaemonUnreachableError,
} from './errors.ts'
import { discoverPort, readPortFile } from './portDiscovery.ts'
import { initTracing } from './tracing.ts'

const ALREADY_RUNNING_RE = /vt-graphd:\s+already running for [^\n(]+\(pid (\d+)\)/
const REUSE_PROBE_AFTER_LOCK_HELD_MS = 2000

const tracer = trace.getTracer('vt-daemon-client')

let tracingInitialized = false
function ensureTracingInit(): void {
  if (tracingInitialized) return
  tracingInitialized = true
  initTracing('vt-daemon-client')
}

const requireFromHere = createRequire(import.meta.url)
const GRAPH_DB_SERVER_ENTRYPOINT = requireFromHere.resolve('@vt/graph-db-server')

// Resolve from the installed workspace package, not from import.meta.url.
// In the bundled Electron main process, import.meta.url points into dist output.
const FALLBACK_BIN_PATH = resolve(
  dirname(GRAPH_DB_SERVER_ENTRYPOINT),
  '../dist/vt-graphd.mjs',
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

async function readAliveLockHolder(vault: string): Promise<number | null> {
  try {
    const raw = await readFile(join(vault, '.voicetree', 'graphd.lock'), 'utf8')
    const pid = Number(raw.trim())
    return isProcessAlive(pid) ? pid : null
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
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
    args: [FALLBACK_BIN_PATH, '--vault', vault],
    env: { ...process.env },
  }
}

export async function ensureDaemon(
  vault: string,
  opts?: { timeoutMs?: number; bin?: string },
): Promise<EnsureDaemonResult> {
  ensureTracingInit()

  return tracer.startActiveSpan('daemon.ensure', async (ensureSpan) => {
    const resolvedVault = resolve(vault)
    const timeoutMs = opts?.timeoutMs ?? 5000
    ensureSpan.setAttribute('vault', resolvedVault)
    ensureSpan.setAttribute('timeoutMs', timeoutMs)

    try {
      // 1. Reuse path: short-wait for existing port file, then /health-verify.
      const reuseResult = await tracer.startActiveSpan(
        'daemon.reuse-probe',
        async (reuseSpan) => {
          let existingPort: number | null = null
          try {
            existingPort = await discoverPort(resolvedVault, {
              timeoutMs: 500,
            })
          } catch (err) {
            if (!(err instanceof DaemonUnreachableError)) {
              reuseSpan.setStatus({
                code: SpanStatusCode.ERROR,
                message: String(err),
              })
              reuseSpan.end()
              throw err
            }
          }
          if (
            existingPort !== null &&
            (await probeHealth(resolvedVault, existingPort))
          ) {
            reuseSpan.setAttribute('reused', true)
            reuseSpan.setAttribute('port', existingPort)
            reuseSpan.end()
            return {
              port: existingPort,
              pid: null,
              launched: false,
            } as EnsureDaemonResult
          }
          reuseSpan.setAttribute('reused', false)
          reuseSpan.end()
          return null
        },
      )

      if (reuseResult) {
        ensureSpan.setAttribute('reused', true)
        ensureSpan.end()
        return reuseResult
      }

      const lockHolderPid = await readAliveLockHolder(resolvedVault)
      if (lockHolderPid !== null) {
        const reuseDeadline = Date.now() + REUSE_PROBE_AFTER_LOCK_HELD_MS
        while (Date.now() < reuseDeadline) {
          const p = await readPortFile(resolvedVault)
          if (p !== null && (await probeHealth(resolvedVault, p))) {
            ensureSpan.setAttribute('reused', true)
            ensureSpan.setAttribute('lockHolderPid', lockHolderPid)
            ensureSpan.end()
            return {
              port: p,
              pid: lockHolderPid,
              launched: false,
            }
          }
          await sleep(100)
        }

        throw new DaemonLockHeldError(resolvedVault, lockHolderPid)
      }

      // 2. Resolve the runtime command.
      const { cmd, args, env } = tracer.startActiveSpan(
        'daemon.resolve-command',
        (resolveSpan) => {
          try {
            const result = resolveCommand(
              resolvedVault,
              process.env.VT_GRAPHD_BIN ?? opts?.bin,
            )
            resolveSpan.setAttribute('cmd', result.cmd)
            resolveSpan.end()
            return result
          } catch (err) {
            resolveSpan.setStatus({
              code: SpanStatusCode.ERROR,
              message: String(err),
            })
            resolveSpan.end()
            throw err
          }
        },
      )

      // 3. Spawn detached + unref'd and poll for readiness.
      return await tracer.startActiveSpan(
        'daemon.spawn-and-wait',
        async (spawnSpan) => {
          let child: ChildProcess = spawn(cmd, args, {
            detached: true,
            env,
            stdio: ['ignore', 'ignore', 'pipe'],
          })
          child.unref()
          unrefIfSupported(child.stderr)
          const spawnedPid = child.pid ?? null
          spawnSpan.setAttribute('pid', spawnedPid ?? 0)

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

          // Poll for port file + /health (lock-coalesces: whoever's port file lands first wins).
          const deadline = Date.now() + timeoutMs
          let backoff = 50
          while (Date.now() < deadline) {
            if (spawnError) {
              spawnSpan.setStatus({
                code: SpanStatusCode.ERROR,
                message: spawnError.message,
              })
              spawnSpan.end()
              throw spawnError
            }

            const port = await readPortFile(resolvedVault)
            if (port !== null && (await probeHealth(resolvedVault, port))) {
              spawnSpan.setAttribute('port', port)
              spawnSpan.end()
              return { port, pid: spawnedPid, launched: true }
            }

            // The spawned child detected the lock was already held and exited via
            // process.exit(0). Continuing to wait timeoutMs for a port file from a
            // dead child is pointless. Give the lock-holder one more reuse probe
            // (in case it's slow rather than dead), then surface a typed error so
            // the caller can recover by killing the orphan.
            if (alreadyRunningPid !== null) {
              const reuseDeadline =
                Date.now() + REUSE_PROBE_AFTER_LOCK_HELD_MS
              while (Date.now() < reuseDeadline) {
                const p = await readPortFile(resolvedVault)
                if (
                  p !== null &&
                  (await probeHealth(resolvedVault, p))
                ) {
                  spawnSpan.setAttribute('port', p)
                  spawnSpan.setAttribute(
                    'alreadyRunningPid',
                    alreadyRunningPid,
                  )
                  spawnSpan.end()
                  return {
                    port: p,
                    pid: alreadyRunningPid,
                    launched: false,
                  }
                }
                await sleep(100)
              }
              const err = new DaemonLockHeldError(
                resolvedVault,
                alreadyRunningPid,
              )
              spawnSpan.setStatus({
                code: SpanStatusCode.ERROR,
                message: err.message,
              })
              spawnSpan.end()
              throw err
            }

            const remaining = deadline - Date.now()
            if (remaining <= 0) break
            await sleep(Math.min(backoff, remaining))
            backoff = Math.min(backoff * 2, 100)
          }

          if (spawnError) {
            spawnSpan.setStatus({
              code: SpanStatusCode.ERROR,
              message: (spawnError as Error).message,
            })
            spawnSpan.end()
            throw spawnError
          }
          const stderrSuffix = stderr.trim()
            ? `\nvt-graphd stderr:\n${stderr.trim()}`
            : ''
          const err = new DaemonLaunchTimeout(
            `vt-graphd did not become ready within ${timeoutMs}ms for vault ${resolvedVault}${stderrSuffix}`,
          )
          spawnSpan.setStatus({
            code: SpanStatusCode.ERROR,
            message: err.message,
          })
          spawnSpan.end()
          throw err
        },
      )
    } catch (err) {
      ensureSpan.setStatus({
        code: SpanStatusCode.ERROR,
        message: String(err),
      })
      throw err
    } finally {
      ensureSpan.end()
    }
  })
}
