import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { trace, SpanStatusCode } from '@opentelemetry/api'

export type CommandSpec = { cmd: string; args: string[]; env?: NodeJS.ProcessEnv }
type DaemonEntrypointDeps = {
  exists: (path: string) => boolean
  resolveTsx: () => string
}
type RuntimeVersions = NodeJS.ProcessVersions & { electron?: string }
type RuntimeCommandInput = {
  env?: NodeJS.ProcessEnv
  execPath?: string
  versions?: Partial<RuntimeVersions>
}
type RuntimeValidation = { ok: true } | { ok: false; reason: string }

const tracer = trace.getTracer('vt-daemon-client')

const requireFromHere = createRequire(import.meta.url)

// Resolve from the installed workspace package root, not from import.meta.url.
// In the bundled Electron main process (and the bundled vt CLI), import.meta.url
// points into dist output, so we cannot derive the daemon binary path from it.
//
// This resolution is intentionally lazy: in headless distributions of the vt
// CLI where the bundle inlines @vt/graph-db-server, the package.json is not
// installed as a separate node module — and that's fine for commands like
// `vt --help` / `vt manual` that never need to spawn the daemon. Surfacing
// the error here would break those commands at module-init time. Code paths
// that actually need to spawn vt-graphd will throw a clear error.
let cachedGraphDbServerRoot: string | undefined

function resolveGraphDbServerRoot(): string {
  if (cachedGraphDbServerRoot !== undefined) return cachedGraphDbServerRoot
  const pkgJsonPath = requireFromHere.resolve('@vt/graph-db-server/package.json')
  cachedGraphDbServerRoot = dirname(pkgJsonPath)
  return cachedGraphDbServerRoot
}

function fallbackBinPath(): string {
  return resolve(resolveGraphDbServerRoot(), 'dist', 'vt-graphd.mjs')
}

function sourceBinPath(): string {
  return resolve(resolveGraphDbServerRoot(), 'bin', 'vt-graphd.ts')
}

const runtimeValidationCache = new Map<string, RuntimeValidation>()
const runtimeCommandCache = new Map<string, string>()

export function resolveDaemonRuntimeCommand(
  input: RuntimeCommandInput = {},
): string {
  return tracer.startActiveSpan('daemon.resolve-runtime-command', (span) => {
    const env = input.env ?? process.env
    const candidates = daemonRuntimeCandidates({
      env,
      execPath: input.execPath ?? process.execPath,
      versions: input.versions ?? process.versions,
    })
    span.setAttribute('candidateCount', candidates.length)

    const cacheKey = runtimeCommandCacheKey(candidates, env)
    const cached = runtimeCommandCache.get(cacheKey)
    if (cached) {
      span.setAttribute('cacheHit', true)
      span.setAttribute('cmd', cached)
      span.end()
      return cached
    }
    span.setAttribute('cacheHit', false)

    const failures: string[] = []

    for (const [index, candidate] of candidates.entries()) {
      const validation = validateDaemonRuntime(candidate, env)
      if (validation.ok) {
        runtimeCommandCache.set(cacheKey, candidate)
        span.setAttribute('validatedCount', index + 1)
        span.setAttribute('cmd', candidate)
        span.end()
        return candidate
      }
      failures.push(`${candidate}: ${validation.reason}`)
    }

    span.setAttribute('validatedCount', candidates.length)
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: 'No node:sqlite-capable runtime found',
    })
    span.end()
    throw new Error(
      `Could not find a Node runtime for vt-graphd that supports node:sqlite. Checked: ${failures.join('; ')}`,
    )
  })
}

export function resolveCommand(
  vault: string,
  override: string | undefined,
): CommandSpec {
  const trimmed = override?.trim()
  if (trimmed) {
    const parts = trimmed.split(/\s+/)
    const [cmd, ...rest] = parts
    return { cmd, args: [...rest, '--vault', vault] }
  }
  return {
    cmd: resolveDaemonRuntimeCommand(),
    args: resolveDefaultDaemonArgs(vault),
    env: { ...process.env },
  }
}

export function resolveDefaultDaemonArgs(
  vault: string,
  deps: DaemonEntrypointDeps = {
    exists: existsSync,
    resolveTsx: () => requireFromHere.resolve('tsx'),
  },
): string[] {
  const fallback = fallbackBinPath()
  if (deps.exists(fallback)) {
    return [fallback, '--vault', vault]
  }

  const source = sourceBinPath()
  if (deps.exists(source)) {
    return [
      '--import',
      deps.resolveTsx(),
      source,
      '--vault',
      vault,
    ]
  }

  return [fallback, '--vault', vault]
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

function runtimeCommandCacheKey(
  candidates: string[],
  env: NodeJS.ProcessEnv,
): string {
  return [...candidates, env.PATH ?? '', env.Path ?? ''].join('\0')
}

function runtimeValidationCacheKey(
  candidate: string,
  env: NodeJS.ProcessEnv,
): string {
  return [candidate, env.PATH ?? '', env.Path ?? ''].join('\0')
}

function validateDaemonRuntime(
  candidate: string,
  env: NodeJS.ProcessEnv,
): RuntimeValidation {
  return tracer.startActiveSpan('daemon.validate-runtime', (span) => {
    span.setAttribute('candidate', candidate)
    const cacheKey = runtimeValidationCacheKey(candidate, env)
    const cached = runtimeValidationCache.get(cacheKey)
    if (cached) {
      span.setAttribute('cacheHit', true)
      span.setAttribute('ok', cached.ok)
      span.end()
      return cached
    }
    span.setAttribute('cacheHit', false)

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

    let validation: RuntimeValidation
    if (result.status === 0) {
      validation = { ok: true }
    } else if (result.error) {
      validation = { ok: false, reason: result.error.message }
    } else {
      const stderr = result.stderr.trim()
      const stdout = result.stdout.trim()
      const detail =
        stderr || stdout || `exit status ${result.status ?? 'unknown'}`
      validation = { ok: false, reason: detail.split('\n').at(-1) ?? detail }
    }

    runtimeValidationCache.set(cacheKey, validation)
    span.setAttribute('ok', validation.ok)
    span.end()
    return validation
  })
}
