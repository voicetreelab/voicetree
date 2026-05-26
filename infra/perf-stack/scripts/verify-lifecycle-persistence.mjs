#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readdir, readFile, stat, writeFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const SCENARIO_MS = 12_000
const POLL_INTERVAL_MS = 1_000
const POLL_TIMEOUT_MS = 45_000
const VM_URL = 'http://localhost:8428'
const LOKI_URL = 'http://localhost:3100'
const TEMPO_URL = 'http://localhost:3200'
const PYROSCOPE_URL = 'http://localhost:4040'
const PROFILE_TYPE = 'wall:cpu:nanoseconds:wall:nanoseconds'

const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
const unixSeconds = (ms) => Math.floor(ms / 1000)

function runUuid(prefix) {
  return `${prefix}-${randomUUID()}`
}

function runDir(uuid) {
  return join(homedir(), '.voicetree', 'perf', uuid)
}

function queryUrl(baseUrl, path, params) {
  const url = new URL(path, baseUrl)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value))
  }
  return url
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
      process.stdout.write(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
      process.stderr.write(chunk)
    })
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (code === 0) return resolveCommand({ stdout, stderr })
      reject(new Error(`${command} ${args.join(' ')} failed code=${code} signal=${signal ?? 'none'}\n${stdout}${stderr}`))
    })
  })
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5_000) })
  const body = await response.text()
  if (!response.ok) throw new Error(`${url} failed ${response.status}: ${body.trim()}`)
  return body.length > 0 ? JSON.parse(body) : {}
}

function prometheusHasSeries(payload) {
  return payload?.status === 'success'
    && Array.isArray(payload?.data?.result)
    && payload.data.result.length > 0
}

function lokiEventCount(payload) {
  const streams = payload?.data?.result
  if (!Array.isArray(streams)) return 0
  return streams.reduce((count, stream) => count + (Array.isArray(stream.values) ? stream.values.length : 0), 0)
}

function tempoTraceCount(payload) {
  return Array.isArray(payload?.traces) ? payload.traces.length : 0
}

function pyroscopeSampleCount(payload) {
  const samples = payload?.timeline?.samples
  if (!Array.isArray(samples)) return 0
  return samples.reduce((sum, sample) => sum + (Number.isFinite(sample) ? sample : 0), 0)
}

async function queryBackends({ uuid, fromMs }) {
  const victoriaMetrics = await fetchJson(queryUrl(VM_URL, '/api/v1/query', {
    query: `{__name__=~".+", service_instance_id="${uuid}"}`,
  }))

  const loki = await fetchJson(queryUrl(LOKI_URL, '/loki/api/v1/query_range', {
    query: `{service_instance_id="${uuid}"}`,
    start: String(BigInt(fromMs - 5_000) * 1_000_000n),
    end: String(BigInt(Date.now() + 1_000) * 1_000_000n),
    limit: '100',
  }))

  const tempo = await fetchJson(queryUrl(TEMPO_URL, '/api/search', {
    q: `{resource.service.instance.id="${uuid}"}`,
    limit: '20',
  }))

  const pyroscope = await fetchJson(queryUrl(PYROSCOPE_URL, '/pyroscope/render', {
    query: `${PROFILE_TYPE}{service_name="vt-graphd",service_instance_id="${uuid}"}`,
    from: unixSeconds(fromMs - 5_000),
    until: unixSeconds(Date.now() + 1_000),
    format: 'json',
  }))

  return {
    metrics: prometheusHasSeries(victoriaMetrics),
    logs: lokiEventCount(loki) > 0,
    traces: tempoTraceCount(tempo) > 0,
    profiles: pyroscopeSampleCount(pyroscope) > 0,
  }
}

async function pollBackends({ uuid, fromMs, expected }) {
  const startedAt = Date.now()
  let last
  let lastError

  while (Date.now() - startedAt <= POLL_TIMEOUT_MS) {
    try {
      last = await queryBackends({ uuid, fromMs })
      const values = Object.values(last)
      if (values.every((value) => value === expected)) return { ok: true, backends: last }
    } catch (err) {
      lastError = err
    }
    await delay(POLL_INTERVAL_MS)
  }

  return {
    ok: false,
    backends: last,
    error: lastError instanceof Error ? lastError.message : undefined,
  }
}

async function inspectPlainArtifacts(uuid) {
  const dir = runDir(uuid)
  const logPath = join(dir, 'logs', 'vt-graphd.log')
  const heapDir = join(dir, 'heap-snapshots')
  const [logStats, heapEntries, logText] = await Promise.all([
    stat(logPath),
    readdir(heapDir),
    readFile(logPath, 'utf8'),
  ])
  const heapSnapshots = heapEntries.filter((entry) => entry.endsWith('.heapsnapshot')).sort()
  return {
    ok: logStats.size > 0 && heapSnapshots.length > 0,
    run_dir: dir,
    log_path: logPath,
    log_bytes: logStats.size,
    log_lines: logText.trim().length === 0 ? 0 : logText.trim().split('\n').length,
    heap_snapshot_count: heapSnapshots.length,
    heap_snapshots: heapSnapshots,
  }
}

async function runScenario(uuid) {
  const startedAtMs = Date.now()
  await runCommand('npm', ['run', 'perf:scenario'], {
    env: {
      ...process.env,
      VOICETREE_RUN_INSTANCE_ID: uuid,
      VOICETREE_PERF_SCENARIO_MS: String(SCENARIO_MS),
    },
  })
  return startedAtMs
}

async function lifecycle(args) {
  await runCommand('npm', ['run', `perf:${args[0]}`, '--', ...args.slice(1)])
}

function assertCheck(name, result) {
  if (!result.ok) {
    throw new Error(`${name} failed: ${JSON.stringify(result, null, 2)}`)
  }
}

async function writeResult(uuid, result) {
  const resultPath = join(runDir(uuid), 'verify', 'lifecycle-persistence.json')
  await mkdir(dirname(resultPath), { recursive: true })
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`)
  return resultPath
}

async function verifyLifecyclePersistence() {
  const defaultWipeRun = runUuid('r9-wipe')
  const persistRun = runUuid('r9-persist')

  await lifecycle(['check'])

  const defaultWipeStartedAtMs = await runScenario(defaultWipeRun)
  const defaultWipePresent = await pollBackends({
    uuid: defaultWipeRun,
    fromMs: defaultWipeStartedAtMs,
    expected: true,
  })
  assertCheck('default-wipe precondition backend presence', defaultWipePresent)
  const defaultWipeArtifactsBefore = await inspectPlainArtifacts(defaultWipeRun)
  assertCheck('default-wipe artifact precondition', defaultWipeArtifactsBefore)

  await lifecycle(['down'])
  await lifecycle(['up'])

  const defaultWipeAbsent = await pollBackends({
    uuid: defaultWipeRun,
    fromMs: defaultWipeStartedAtMs,
    expected: false,
  })
  assertCheck('default-wipe backend absence after restart', defaultWipeAbsent)
  const defaultWipeArtifactsAfter = await inspectPlainArtifacts(defaultWipeRun)
  assertCheck('default-wipe artifact survival', defaultWipeArtifactsAfter)

  const persistStartedAtMs = await runScenario(persistRun)
  const persistPresentBefore = await pollBackends({
    uuid: persistRun,
    fromMs: persistStartedAtMs,
    expected: true,
  })
  assertCheck('persist precondition backend presence', persistPresentBefore)
  const persistArtifactsBefore = await inspectPlainArtifacts(persistRun)
  assertCheck('persist artifact precondition', persistArtifactsBefore)

  await lifecycle(['down', '--persist'])
  await lifecycle(['up'])

  const persistPresentAfter = await pollBackends({
    uuid: persistRun,
    fromMs: persistStartedAtMs,
    expected: true,
  })
  assertCheck('persist backend presence after restart', persistPresentAfter)
  const persistArtifactsAfter = await inspectPlainArtifacts(persistRun)
  assertCheck('persist artifact survival', persistArtifactsAfter)

  const result = {
    ok: true,
    default_wipe: {
      run_uuid: defaultWipeRun,
      backends_present_before_down: defaultWipePresent.backends,
      backends_absent_after_restart: defaultWipeAbsent.backends,
      artifacts_before_down: defaultWipeArtifactsBefore,
      artifacts_after_restart: defaultWipeArtifactsAfter,
    },
    persist: {
      run_uuid: persistRun,
      backends_present_before_down: persistPresentBefore.backends,
      backends_present_after_restart: persistPresentAfter.backends,
      artifacts_before_down: persistArtifactsBefore,
      artifacts_after_restart: persistArtifactsAfter,
    },
  }
  const resultPath = await writeResult(persistRun, result)
  console.log(`ok lifecycle persistence result=${resultPath}`)
  return result
}

verifyLifecyclePersistence().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
