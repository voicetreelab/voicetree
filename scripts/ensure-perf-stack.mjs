#!/usr/bin/env node
// Idempotent preflight that makes the local LGTM perf stack ready and resolves
// the OTLP endpoint a launched process should export to.
//
//   - installs the native binaries if infra/perf-stack/bin/ is empty (first run)
//   - brings the stack up (lifecycle.mjs `up` is itself idempotent: its ps-scan
//     skips services that are already running, so a warm stack is a fast no-op)
//   - returns the OTLP gRPC endpoint + a per-run service.instance.id
//
// `ensurePerfStack` is the deep function: it owns the decision/sequencing and
// takes its impurity (subprocess runner, bin probe, logger, id generator) as
// injected ports so it is exercised as a black box. The CLI entrypoint at the
// bottom supplies the real ports and then launches the wrapped command with the
// resolved endpoint in its environment.
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { DEFAULT_OTLP_ENDPOINT, GRAFANA_BASE_URL } from './perf-stack-endpoints.mjs'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PERF_BIN_DIR = join(REPO_ROOT, 'infra/perf-stack/bin')
const INSTALL_SCRIPT = join(REPO_ROOT, 'infra/perf-stack/scripts/install-binaries.mjs')
const LIFECYCLE_SCRIPT = join(REPO_ROOT, 'infra/perf-stack/scripts/lifecycle.mjs')
const INSTALL_MANIFEST = '.install-manifest.json'

// Opt-out lever: PERF_STACK=0 makes the preflight a complete no-op so the
// launched process runs exactly as it does today (NDJSON-only, no collector).
// Default-on is what makes "just run the app" work; this is the escape hatch.
export const PERF_STACK_DISABLED = '0'

// The only two actions the preflight drives against the perf stack. Kept as a
// closed vocabulary so the injected `run` port has a precise, testable contract.
/** @typedef {'install' | 'up'} PerfStackAction */

/**
 * @typedef {object} EnsurePerfStackPorts
 * @property {NodeJS.ProcessEnv} env                                    base environment (read-only)
 * @property {(action: PerfStackAction) => Promise<{ code: number, stdout?: string, stderr?: string }>} run  effect boundary
 * @property {() => Promise<boolean>} binHasContents                    true when binaries are already installed
 * @property {(message: string) => void} [log]                          progress sink (defaults to stderr)
 * @property {() => string} [newRunId]                                  fresh run id factory (defaults to uuid v4)
 */

/**
 * @param {EnsurePerfStackPorts} ports
 * @returns {Promise<{ enabled: false } | { enabled: true, endpoint: string, instanceId: string }>}
 */
export async function ensurePerfStack({
  env,
  run,
  binHasContents,
  log = (message) => process.stderr.write(`${message}\n`),
  newRunId = randomUUID,
}) {
  if (env.PERF_STACK === PERF_STACK_DISABLED) {
    return { enabled: false }
  }

  if (!(await binHasContents())) {
    log('installing perf stack (first run only)…')
    const install = await run('install')
    if (install.code !== 0) {
      throw new Error(perfStackFailure('install perf stack binaries', install))
    }
  }

  const up = await run('up')
  if (up.code !== 0) {
    throw new Error(perfStackFailure('start the perf stack', up))
  }

  return {
    enabled: true,
    endpoint: resolveEndpoint(env),
    instanceId: resolveInstanceId(env, newRunId),
  }
}

function resolveEndpoint(env) {
  const configured = env.VOICETREE_OTLP_ENDPOINT
  return configured && configured.length > 0 ? configured : DEFAULT_OTLP_ENDPOINT
}

function resolveInstanceId(env, newRunId) {
  const configured = env.VOICETREE_RUN_INSTANCE_ID
  return configured && configured.length > 0 ? configured : newRunId()
}

function perfStackFailure(action, result) {
  return [
    `ensure-perf-stack: failed to ${action} (exit ${result.code})`,
    result.stdout?.trim(),
    result.stderr?.trim(),
  ]
    .filter(Boolean)
    .join('\n')
}

// ---------------------------------------------------------------------------
// CLI shell — real ports + command launch. Everything below is the impure edge.
// ---------------------------------------------------------------------------

async function realBinHasContents() {
  try {
    const entries = await readdir(PERF_BIN_DIR)
    return entries.some((entry) => entry !== INSTALL_MANIFEST)
  } catch {
    // ENOENT (dir absent) → binaries not installed.
    return false
  }
}

/** @type {(action: PerfStackAction) => Promise<{ code: number }>} */
function realRun(action) {
  const args = action === 'install' ? [INSTALL_SCRIPT] : [LIFECYCLE_SCRIPT, 'up']
  return new Promise((resolveRun, reject) => {
    // Stream install/up output straight to the user so first-run downloads and
    // service readiness are visible; the exit code is the success signal.
    const child = spawn(process.execPath, args, { cwd: REPO_ROOT, stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', (code, signal) => resolveRun({ code: signal ? 1 : code ?? 1 }))
  })
}

function launch(command, args, env) {
  return new Promise((resolveLaunch, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), env, stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', (code, signal) => resolveLaunch({ code, signal }))
  })
}

async function main(argv = process.argv.slice(2), baseEnv = process.env) {
  if (argv.length === 0) {
    throw new Error('usage: ensure-perf-stack.mjs <command> [args…]')
  }

  const result = await ensurePerfStack({
    env: baseEnv,
    run: realRun,
    binHasContents: realBinHasContents,
  })

  const [command, ...commandArgs] = argv
  const launchEnv = { ...baseEnv }
  if (result.enabled) {
    launchEnv.VOICETREE_OTLP_ENDPOINT = result.endpoint
    launchEnv.VOICETREE_RUN_INSTANCE_ID = result.instanceId
    process.stdout.write(
      `Grafana: ${GRAFANA_BASE_URL}\nPerf run: ${result.instanceId}\nOTLP: ${result.endpoint}\n`,
    )
  } else {
    // Opt-out: guarantee the exporter stays detached even if the endpoint was
    // already present in the inherited env — PERF_STACK=0 means no collector.
    delete launchEnv.VOICETREE_OTLP_ENDPOINT
    process.stdout.write('Perf stack disabled (PERF_STACK=0); OTLP export off, NDJSON unaffected\n')
  }

  const { code, signal } = await launch(command, commandArgs, launchEnv)
  if (signal) {
    process.kill(process.pid, signal)
    return 1
  }
  return code ?? 1
}

const isEntrypoint = import.meta.url === pathToFileURL(process.argv[1]).href
if (isEntrypoint) {
  main().then(
    (code) => {
      process.exitCode = code
    },
    (err) => {
      process.stderr.write(`ensure-perf-stack: ${err instanceof Error ? err.message : String(err)}\n`)
      process.exitCode = 1
    },
  )
}
