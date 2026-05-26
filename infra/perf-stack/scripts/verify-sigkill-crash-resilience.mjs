#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '../../..')
const LOGCLI = join(REPO_ROOT, 'infra/perf-stack/bin/logcli')
const OTLP_ENDPOINT = 'http://localhost:4317'
const READY_TIMEOUT_MS = 15_000
const LOKI_TIMEOUT_MS = 20_000
const POLL_INTERVAL_MS = 500
const MIN_LINES_BEFORE_KILL = 4

const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms))

function runCommand(command, args, options = {}) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? REPO_ROOT,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      resolveCommand({ code, signal, stdout, stderr })
    })
  })
}

async function assertPerfStackUp() {
  const result = await runCommand('npm', ['run', 'perf:check'])
  if (result.code !== 0) {
    throw new Error([
      'perf stack is not ready; run `npm run perf:up` first',
      result.stdout.trim(),
      result.stderr.trim(),
    ].filter(Boolean).join('\n'))
  }
  return result.stdout
}

async function makeScenarioVault(runUuid) {
  const vaultDir = join(tmpdir(), `vt-perf-sigkill-${runUuid}`)
  await mkdir(vaultDir, { recursive: true })
  await writeFile(
    join(vaultDir, 'sigkill-scenario.md'),
    `# SIGKILL crash-resilience scenario\n\nRun UUID: ${runUuid}\n`,
    'utf8',
  )
  return vaultDir
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

function logBodiesFromPlainText(text) {
  if (text.length === 0) return []
  if (!text.endsWith('\n')) {
    throw new Error('plain vt-graphd log has a truncated final line')
  }

  return text.trimEnd().split('\n').map((line) => {
    const match = /^\S+\s+\S+\s+(?<body>.*)$/.exec(line)
    if (!match?.groups?.body) throw new Error(`plain vt-graphd log line has unexpected shape: ${line}`)
    return match.groups.body
  })
}

async function readPlainLogBodies(logPath) {
  const text = await readFile(logPath, 'utf8')
  return logBodiesFromPlainText(text)
}

async function waitForPlainLogBodies(logPath, minimumCount) {
  const startedAt = Date.now()
  let lastError
  while (Date.now() - startedAt <= READY_TIMEOUT_MS) {
    try {
      const bodies = await readPlainLogBodies(logPath)
      if (bodies.length >= minimumCount) return bodies
    } catch (err) {
      lastError = err
    }
    await delay(POLL_INTERVAL_MS)
  }
  throw new Error(`plain vt-graphd log did not reach ${minimumCount} complete lines: ${lastError?.message ?? 'not found'}`)
}

function spawnGraphd({ runUuid, projectRoot }) {
  return spawn(process.execPath, [
    '--import',
    'tsx',
    'packages/systems/graph-db-server/bin/vt-graphd.ts',
    '--project-root',
    projectRoot,
    '--log-level',
    'info',
    '--idle-timeout-ms',
    '60000',
  ], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      VOICETREE_RUN_INSTANCE_ID: runUuid,
      VOICETREE_OTLP_ENDPOINT: OTLP_ENDPOINT,
      VOICETREE_PERF_PROFILE: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

async function waitForKilled(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise((resolveExit) => child.once('exit', resolveExit))
}

async function queryLokiBodies({ runUuid, expectedCount }) {
  const query = `{service_name="vt-graphd",service_instance_id="${runUuid}"}`
  const result = await runCommand(LOGCLI, [
    '--addr=http://localhost:3100',
    'query',
    query,
    '--since=10m',
    '--limit=0',
    '--forward',
    '--quiet',
    '--output=raw',
  ])

  if (result.code !== 0) {
    throw new Error(`logcli query failed code=${result.code}\n${result.stdout.trim()}\n${result.stderr.trim()}`)
  }

  const bodies = result.stdout.split('\n').filter((line) => line.length > 0)
  if (bodies.length < expectedCount) {
    throw new Error(`Loki returned ${bodies.length}/${expectedCount} vt-graphd lines`)
  }
  return bodies
}

async function waitForLokiBodies({ runUuid, expectedCount }) {
  const startedAt = Date.now()
  let lastError
  while (Date.now() - startedAt <= LOKI_TIMEOUT_MS) {
    try {
      return await queryLokiBodies({ runUuid, expectedCount })
    } catch (err) {
      lastError = err
    }
    await delay(POLL_INTERVAL_MS)
  }
  throw lastError ?? new Error('timed out waiting for Loki lines')
}

function countBodies(bodies) {
  const counts = new Map()
  for (const body of bodies) counts.set(body, (counts.get(body) ?? 0) + 1)
  return counts
}

function assertSameBodies({ plainBodies, lokiBodies }) {
  if (plainBodies.length !== lokiBodies.length) {
    throw new Error(`plain/Loki line count mismatch: plain=${plainBodies.length} loki=${lokiBodies.length}`)
  }

  const lokiCounts = countBodies(lokiBodies)
  const missing = []
  for (const [body, count] of countBodies(plainBodies)) {
    if ((lokiCounts.get(body) ?? 0) !== count) missing.push(body)
  }
  if (missing.length > 0) {
    throw new Error(`Loki missing ${missing.length} plain log bodies, first missing: ${missing[0]}`)
  }
}

async function writeResult({ runDir, result }) {
  const verifyDir = join(runDir, 'verify')
  await mkdir(verifyDir, { recursive: true })
  const resultPath = join(verifyDir, 'sigkill-crash-resilience.json')
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`)
  return resultPath
}

async function verifySigkillCrashResilience() {
  const runUuid = process.env.VOICETREE_RUN_INSTANCE_ID && process.env.VOICETREE_RUN_INSTANCE_ID.length > 0
    ? process.env.VOICETREE_RUN_INSTANCE_ID
    : randomUUID()
  const runDir = join(homedir(), '.voicetree', 'perf', runUuid)
  const logPath = join(runDir, 'logs', 'vt-graphd.log')
  const projectRoot = await makeScenarioVault(runUuid)
  const checkedBefore = await assertPerfStackUp()
  const child = spawnGraphd({ runUuid, projectRoot })

  let plainBodiesBeforeKill = []
  try {
    await waitForReady(child, READY_TIMEOUT_MS)
    plainBodiesBeforeKill = await waitForPlainLogBodies(logPath, MIN_LINES_BEFORE_KILL)
    process.kill(child.pid, 'SIGKILL')
    await waitForKilled(child)
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
      await waitForKilled(child)
    }
  }

  if (child.signalCode !== 'SIGKILL') {
    throw new Error(`vt-graphd did not exit from SIGKILL: code=${child.exitCode} signal=${child.signalCode ?? 'none'}`)
  }

  const plainBodiesAfterKill = await readPlainLogBodies(logPath)
  const lokiBodies = await waitForLokiBodies({
    runUuid,
    expectedCount: plainBodiesAfterKill.length,
  })
  assertSameBodies({ plainBodies: plainBodiesAfterKill, lokiBodies })
  const checkedAfter = await assertPerfStackUp()

  const result = {
    signal: 'sigkill-crash-resilience',
    ok: true,
    run_uuid: runUuid,
    killed_pid: child.pid,
    plain_log_path: logPath,
    plain_lines_before_kill: plainBodiesBeforeKill.length,
    plain_lines_after_kill: plainBodiesAfterKill.length,
    loki_lines: lokiBodies.length,
    logcli_query: `{service_name="vt-graphd",service_instance_id="${runUuid}"}`,
    stack_check_before: checkedBefore,
    stack_check_after: checkedAfter,
  }
  const resultPath = await writeResult({ runDir, result })
  console.log(`sigkill crash-resilience OK plain_lines=${plainBodiesAfterKill.length} loki_lines=${lokiBodies.length} result=${resultPath}`)
  return true
}

verifySigkillCrashResilience()
  .then((ok) => process.exit(ok ? 0 : 1))
  .catch((err) => {
    console.error(err.message)
    process.exit(1)
  })
