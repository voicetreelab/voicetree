#!/usr/bin/env node
// Idempotent preflight that makes the local LGTM perf stack ready and resolves
// the OTLP endpoint a launched process should export to.
//
//   - installs the native binaries if any expected binary is missing (first run,
//     or recovery from an interrupted install — install-binaries.mjs is
//     idempotent and only does work for the binaries not already in place)
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
import { BINARY_NAMES } from '../infra/perf-stack/scripts/install-binaries.mjs'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PERF_BIN_DIR = join(REPO_ROOT, 'infra/perf-stack/bin')
const INSTALL_SCRIPT = join(REPO_ROOT, 'infra/perf-stack/scripts/install-binaries.mjs')
const LIFECYCLE_SCRIPT = join(REPO_ROOT, 'infra/perf-stack/scripts/lifecycle.mjs')

// Opt-in lever: the perf stack is OFF by default, so "just run the app" stays
// NDJSON-only with no resident collector services and no first-run install.
// Set PERF_STACK=1 (inline on the launch, or in your .env) to make the
// preflight install the binaries, bring the stack up, and attach the OTLP
// exporter. Anything else (absent, empty, `0`, `false`) is a complete no-op.
export const PERF_STACK_ENABLED = '1'

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {boolean} true only when PERF_STACK is explicitly switched on
 */
export function perfStackEnabled(env) {
  return env.PERF_STACK === PERF_STACK_ENABLED
}

// Interactive launches get the always-on-safe `lite` perf tier (wall sampling +
// runtime metrics + log — see perf-probe.mjs). `deep` (heap snapshots) stays
// reserved for the explicit storm path; the preflight never selects it.
export const INTERACTIVE_PERF_TIER = 'lite'

// The only two actions the preflight drives against the perf stack. Kept as a
// closed vocabulary so the injected `run` port has a precise, testable contract.
/** @typedef {'install' | 'up'} PerfStackAction */

/**
 * @typedef {object} EnsurePerfStackPorts
 * @property {NodeJS.ProcessEnv} env                                    base environment (read-only)
 * @property {(action: PerfStackAction) => Promise<{ code: number, stdout?: string, stderr?: string }>} run  effect boundary
 * @property {() => Promise<boolean>} installIsComplete                 true when every expected binary is present
 * @property {(message: string) => void} [log]                          progress sink (defaults to stderr)
 * @property {() => string} [newRunId]                                  fresh run id factory (defaults to uuid v4)
 */

/**
 * @param {EnsurePerfStackPorts} ports
 * @returns {Promise<{ enabled: false } | { enabled: true, endpoint: string, instanceId: string, tier: string }>}
 */
export async function ensurePerfStack({
  env,
  run,
  installIsComplete,
  log = (message) => process.stderr.write(`${message}\n`),
  newRunId = randomUUID,
}) {
  if (!perfStackEnabled(env)) {
    return { enabled: false }
  }

  // Re-runs whenever the install is incomplete — a partial/interrupted install
  // converges here rather than wedging. The installer is idempotent, so on a
  // complete stack this branch is skipped and on a partial one it only fills
  // in the missing binaries.
  if (!(await installIsComplete())) {
    log('installing perf stack…')
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
    tier: INTERACTIVE_PERF_TIER,
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

async function realInstallIsComplete() {
  try {
    const present = new Set(await readdir(PERF_BIN_DIR))
    // Complete iff every binary the installer produces is on disk. A partial
    // install (some names missing) reads as incomplete, so the preflight
    // re-runs the idempotent installer instead of proceeding to a doomed `up`.
    return BINARY_NAMES.every((name) => present.has(name))
  } catch {
    // ENOENT (dir absent) → nothing installed yet.
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
    installIsComplete: realInstallIsComplete,
  })

  const [command, ...commandArgs] = argv
  const launchEnv = { ...baseEnv }
  if (result.enabled) {
    launchEnv.VOICETREE_OTLP_ENDPOINT = result.endpoint
    launchEnv.VOICETREE_RUN_INSTANCE_ID = result.instanceId
    // Select the always-on lite perf tier so the launched process (and the
    // vt-graphd it spawns, which inherits this env) emits profiles + runtime
    // metrics — the latter is what populates the VT Runs dashboard.
    launchEnv.VOICETREE_PERF_TIER = result.tier
    process.stdout.write(
      `Grafana: ${GRAFANA_BASE_URL}\nPerf run: ${result.instanceId}\nOTLP: ${result.endpoint}\nPerf tier: ${result.tier}\n`,
    )
  } else {
    // Default (opt-out): guarantee the exporter AND the probe stay detached
    // even if the endpoint/tier were already present in the inherited env —
    // without PERF_STACK=1 there is no collector and no profiling.
    delete launchEnv.VOICETREE_OTLP_ENDPOINT
    delete launchEnv.VOICETREE_PERF_TIER
    process.stdout.write('Perf stack off (set PERF_STACK=1 to enable); OTLP export + profiling off, NDJSON unaffected\n')
  }

  const { code, signal } = await launch(command, commandArgs, launchEnv)
  if (signal) {
    process.kill(process.pid, signal)
    return 1
  }
  return code ?? 1
}

// `process.argv[1]` is absent under `node -e`, workers, and some test runners;
// guard it so an import in those contexts can't crash on pathToFileURL(undefined).
const isEntrypoint = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href
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
