import { spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { trace, SpanStatusCode } from '@opentelemetry/api'

export type CommandSpec = { cmd: string; args: string[]; env?: NodeJS.ProcessEnv }
type DaemonEntrypointDeps = {
  exists: (path: string) => boolean
  resolveTsx: () => string
  siblingDaemonPath: () => string | undefined
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

// Two distribution shapes ship the daemon, and the resolver has to handle both:
//
//   1. Published @voicetree/cli tarball — `dist/vt-graphd.mjs` sits next to the
//      consuming CLI bundle. `@vt/graph-db-server` is *not* installed as a
//      separate package (it's a private workspace dep). We locate the daemon
//      via `import.meta.url` of this module, which esbuild rewrites to point
//      into the bundled CLI's `dist/` directory.
//   2. Workspace dev / Electron — `@vt/graph-db-server` *is* installed (as a
//      workspace dep or bundled into Electron's node_modules). We locate the
//      daemon by resolving the package.
//
// Both lookups are lazy: commands like `vt --help` / `vt manual` never spawn
// the daemon, and we don't want module-init to fail for them when the workspace
// package isn't installed.
let cachedGraphDbServerRoot: string | undefined

function resolveGraphDbServerRoot(): string | undefined {
  if (cachedGraphDbServerRoot !== undefined) return cachedGraphDbServerRoot
  try {
    const pkgJsonPath = requireFromHere.resolve(
      '@vt/graph-db-server/package.json',
    )
    cachedGraphDbServerRoot = dirname(pkgJsonPath)
    return cachedGraphDbServerRoot
  } catch {
    return undefined
  }
}

function fallbackBinPath(): string | undefined {
  const root = resolveGraphDbServerRoot()
  return root === undefined ? undefined : resolve(root, 'dist', 'vt-graphd.mjs')
}

function sourceBinPath(): string | undefined {
  const root = resolveGraphDbServerRoot()
  return root === undefined ? undefined : resolve(root, 'bin', 'vt-graphd.ts')
}

function defaultSiblingDaemonPath(): string | undefined {
  try {
    return resolve(dirname(fileURLToPath(import.meta.url)), 'vt-graphd.mjs')
  } catch {
    return undefined
  }
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
    return { cmd, args: [...rest, '--project-root', vault] }
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
    siblingDaemonPath: defaultSiblingDaemonPath,
  },
): string[] {
  // Published CLI tarball: vt-graphd.mjs sits next to the consuming bundle.
  // Checked first because @vt/graph-db-server isn't installed in this layout,
  // so the workspace-package paths would all return undefined.
  const sibling = deps.siblingDaemonPath()
  if (sibling !== undefined && deps.exists(sibling)) {
    return [sibling, '--project-root', vault]
  }

  const fallback = fallbackBinPath()
  const source = sourceBinPath()
  const fallbackExists = fallback !== undefined && deps.exists(fallback)
  const sourceExists = source !== undefined && deps.exists(source)

  // Workspace dev: if dist is stale relative to source (source mtime > dist mtime),
  // running dist will execute an outdated build — exactly how the May-15 dist
  // running `--vault` argv kept getting picked over a source that now parses
  // `--project-root`. Prefer source whenever it's newer; otherwise prefer dist
  // for the no-tsx-overhead path.
  if (fallbackExists && sourceExists && sourceIsNewerThan(source!, fallback!)) {
    return ['--import', deps.resolveTsx(), source!, '--project-root', vault]
  }

  if (fallbackExists) {
    return [fallback!, '--project-root', vault]
  }

  if (sourceExists) {
    return ['--import', deps.resolveTsx(), source!, '--project-root', vault]
  }

  throw new Error(
    'Could not locate vt-graphd entrypoint. Looked for a sibling bundle ' +
      `(${sibling ?? '<unavailable>'}), the @vt/graph-db-server dist build ` +
      `(${fallback ?? '<package not resolvable>'}), and its TS source ` +
      `(${source ?? '<package not resolvable>'}).`,
  )
}

function sourceIsNewerThan(sourcePath: string, distPath: string): boolean {
  try {
    return statSync(sourcePath).mtimeMs > statSync(distPath).mtimeMs
  } catch {
    return false
  }
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
