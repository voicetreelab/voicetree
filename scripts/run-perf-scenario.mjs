#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PERF_LIFECYCLE = join(REPO_ROOT, 'infra/perf-stack/scripts/lifecycle.mjs')

const DEFAULT_DURATION_MS = 30_000
const READY_TIMEOUT_MS = 15_000
const SHUTDOWN_TIMEOUT_MS = 10_000
const OTLP_ENDPOINT = 'http://localhost:2994'

const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms))

function resolveRunUuid(env = process.env) {
  return env.VOICETREE_RUN_INSTANCE_ID && env.VOICETREE_RUN_INSTANCE_ID.length > 0
    ? env.VOICETREE_RUN_INSTANCE_ID
    : randomUUID()
}

function resolveDurationMs(env = process.env) {
  const raw = env.VOICETREE_PERF_SCENARIO_MS
  if (!raw) return DEFAULT_DURATION_MS

  const parsed = Number.parseInt(raw, 10)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`invalid VOICETREE_PERF_SCENARIO_MS: ${raw}`)
  }
  return parsed
}

function runCommand(command, args, options = {}) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
      options.onStdout?.(String(chunk))
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
      options.onStderr?.(String(chunk))
    })
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      resolveCommand({ code, signal, stdout, stderr })
    })
  })
}

async function assertPerfStackUp() {
  const result = await runCommand('node', [PERF_LIFECYCLE, 'check'])
  if (result.code !== 0) {
    throw new Error([
      'perf stack is not ready; run `node infra/perf-stack/scripts/lifecycle.mjs up` with the same VOICETREE_RUN_INSTANCE_ID first',
      result.stdout.trim(),
      result.stderr.trim(),
    ].filter(Boolean).join('\n'))
  }
}

async function makeScenarioProject(runUuid) {
  const projectDir = join(tmpdir(), `vt-perf-scenario-${runUuid}`)
  await mkdir(projectDir, { recursive: true })
  await writeFile(
    join(projectDir, 'perf-scenario.md'),
    `# Perf scenario\n\nRun UUID: ${runUuid}\n`,
    'utf8',
  )
  return projectDir
}

function waitForReady(child, timeoutMs) {
  return new Promise((resolveReady, reject) => {
    let settled = false
    let stdout = ''
    let stderr = ''

    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error(`vt-graphd did not report readiness within ${timeoutMs}ms\n${stdout}${stderr}`))
    }, timeoutMs)

    child.stdout.on('data', (chunk) => {
      const text = String(chunk)
      stdout += text
      process.stdout.write(text)
      if (!settled && text.includes('vt-graphd: listening on')) {
        settled = true
        clearTimeout(timeout)
        resolveReady()
      }
    })
    child.stderr.on('data', (chunk) => {
      const text = String(chunk)
      stderr += text
      process.stderr.write(text)
    })
    child.on('exit', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(new Error(`vt-graphd exited before readiness code=${code} signal=${signal ?? 'none'}\n${stdout}${stderr}`))
    })
    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(err)
    })
  })
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  const deadline = Date.now() + SHUTDOWN_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) return
    await delay(250)
  }
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
  }
}

async function runGraphdScenario({ runUuid, durationMs, projectRoot }) {
  const env = {
    ...process.env,
    VOICETREE_RUN_INSTANCE_ID: runUuid,
    VOICETREE_OTLP_ENDPOINT: OTLP_ENDPOINT,
    VOICETREE_PERF_PROFILE: '1',
  }

  const child = spawn(process.execPath, [
    '--import',
    'tsx',
    'packages/systems/graph-db-server/bin/vt-graphd.ts',
    '--project-root',
    projectRoot,
    '--log-level',
    'info',
    '--idle-timeout-ms',
    String(durationMs + SHUTDOWN_TIMEOUT_MS),
  ], {
    cwd: resolve(process.cwd()),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  try {
    await waitForReady(child, READY_TIMEOUT_MS)
    await delay(durationMs)
  } finally {
    await stopChild(child)
  }
}

async function main() {
  const runUuid = resolveRunUuid()
  const durationMs = resolveDurationMs()
  const projectRoot = process.argv[2] ? resolve(process.argv[2]) : await makeScenarioProject(runUuid)

  process.stdout.write(`Run UUID: ${runUuid}\n`)
  process.stdout.write(`Grafana: http://localhost:2999/?var-run_id=${runUuid}\n`)
  process.stdout.write(`Artifacts: ${join(homedir(), '.voicetree', 'perf', runUuid)}\n`)

  await assertPerfStackUp()
  await runGraphdScenario({ runUuid, durationMs, projectRoot })
  process.stdout.write(`perf scenario complete duration_ms=${durationMs}\n`)
}

try {
  await main()
} catch (err) {
  process.stderr.write(`perf scenario failed: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
}
