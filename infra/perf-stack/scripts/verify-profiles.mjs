#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const BACKEND_URL = 'http://localhost:4040'
const SIGNAL = 'profiles'
const APP_NAME = 'vt-test'
const CHILD_WORK_MS = 5_000
const FLUSH_WAIT_MS = 10_000
const POLL_INTERVAL_MS = 500
const POLL_TIMEOUT_MS = 15_000
const PROFILE_TYPE = 'process_cpu:cpu:nanoseconds:cpu:nanoseconds'
const RENDER_PATH = '/pyroscope/render'

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const requireHome = () => {
  if (!process.env.HOME) throw new Error('HOME is required to write perf verification artifacts')
  return process.env.HOME
}

const unixSeconds = (ms) => Math.floor(ms / 1000)

const renderQueryFor = ({ sentinel, serviceInstanceId }) =>
  `${PROFILE_TYPE}{service_name="${APP_NAME}",sentinel="${sentinel}",service_instance_id="${serviceInstanceId}"}`

const renderUrlFor = ({ query, fromMs, untilMs }) => {
  const url = new URL(`${BACKEND_URL}${RENDER_PATH}`)
  url.searchParams.set('query', query)
  url.searchParams.set('from', String(unixSeconds(fromMs)))
  url.searchParams.set('until', String(unixSeconds(untilMs)))
  url.searchParams.set('format', 'json')
  return url
}

const countTimelineSamples = (payload) => {
  const samples = payload?.timeline?.samples
  if (!Array.isArray(samples)) return 0
  return samples.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0)
}

const countStringOccurrences = (value, needle) => {
  if (typeof value === 'string') return value.includes(needle) ? 1 : 0
  if (Array.isArray(value)) {
    return value.reduce((count, item) => count + countStringOccurrences(item, needle), 0)
  }
  if (value && typeof value === 'object') {
    return Object.values(value).reduce((count, item) => count + countStringOccurrences(item, needle), 0)
  }
  return 0
}

const childProgram = ({ functionName, sentinel, serviceInstanceId }) => `
import Pyroscope from '@pyroscope/nodejs'

Pyroscope.init({
  serverAddress: '${BACKEND_URL}',
  appName: '${APP_NAME}',
  tags: {
    sentinel: '${sentinel}',
    service_instance_id: '${serviceInstanceId}',
  },
  flushIntervalMs: 1_000,
  wall: {
    collectCpuTime: true,
    samplingDurationMs: 1_000,
    samplingIntervalMicros: 1_000,
  },
  heap: {
    samplingIntervalBytes: 64 * 1024 * 1024,
    stackDepth: 16,
  },
})

// The function name itself is the flamegraph sentinel, so it must be defined
// dynamically after the parent generates the UUID-derived suffix.
const runSentinelWork = new Function(\`
  return function ${functionName}() {
    const deadline = Date.now() + ${CHILD_WORK_MS}
    let checksum = 0
    let candidate = 2
    while (Date.now() < deadline) {
      let prime = true
      for (let divisor = 2; divisor * divisor <= candidate; divisor += 1) {
        if (candidate % divisor === 0) {
          prime = false
          break
        }
      }
      if (prime) checksum = (checksum + candidate) % 1_000_000_007
      candidate += 1
    }
    globalThis.__vt_profile_verify_checksum = checksum
  }
\`)()

Pyroscope.startWallProfiling()
runSentinelWork()
await Pyroscope.stopWallProfiling()
`

const runProfileChild = ({ functionName, sentinel, serviceInstanceId }) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '--eval', childProgram({
      functionName,
      sentinel,
      serviceInstanceId,
    })], {
      env: {
        ...process.env,
        DEBUG: process.env.DEBUG ?? '',
      },
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
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() })
      } else {
        reject(new Error(`profile child failed code=${code} signal=${signal ?? 'none'} stderr=${stderr.trim()}`))
      }
    })
  })

const queryPyroscope = async ({ query, fromMs }) => {
  const response = await fetch(renderUrlFor({ query, fromMs, untilMs: Date.now() }), {
    signal: AbortSignal.timeout(2_000),
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Pyroscope render failed: ${response.status} ${body.trim()}`)
  }
  return response.json()
}

const pollPyroscope = async ({ query, fromMs, functionName, sentinel }) => {
  const startedAtMs = Date.now()
  let lastError
  let lastPayload

  while (Date.now() - startedAtMs <= POLL_TIMEOUT_MS) {
    await delay(POLL_INTERVAL_MS)
    try {
      const payload = await queryPyroscope({ query, fromMs })
      lastPayload = payload
      const sentinelFunctionMatches = countStringOccurrences(payload, functionName)
      const sentinelTagMatches = countStringOccurrences(payload, sentinel)
      const samples = countTimelineSamples(payload)
      if (sentinelFunctionMatches > 0 || sentinelTagMatches > 0) {
        return {
          found: true,
          sentinelFunctionMatches,
          sentinelTagMatches,
          samples,
        }
      }
    } catch (err) {
      lastError = err
    }
  }

  return {
    found: false,
    sentinelFunctionMatches: lastPayload ? countStringOccurrences(lastPayload, functionName) : 0,
    sentinelTagMatches: lastPayload ? countStringOccurrences(lastPayload, sentinel) : 0,
    samples: lastPayload ? countTimelineSamples(lastPayload) : 0,
    lastError,
  }
}

const writeResult = async ({ runDir, result }) => {
  const verifyDir = join(runDir, 'verify')
  await mkdir(verifyDir, { recursive: true })
  const resultPath = join(verifyDir, `${SIGNAL}.json`)
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`)
  return resultPath
}

const resultFor = ({ ok, sentinel, roundTripMs, query, details }) => ({
  signal: SIGNAL,
  ok,
  sentinel,
  round_trip_ms: roundTripMs,
  backend_url: BACKEND_URL,
  query,
  details,
})

const verifyProfiles = async () => {
  const home = requireHome()
  const sentinel = randomUUID()
  const serviceInstanceId = randomUUID()
  const sentinelShort = sentinel.replaceAll('-', '').slice(0, 12)
  const functionName = `__vt_test_fn_${sentinelShort}`
  const runDir = join(home, '.voicetree', 'perf', serviceInstanceId)
  const query = renderQueryFor({ sentinel, serviceInstanceId })
  const startedAtMs = Date.now()

  let childOutput
  let pollResult
  let childError

  try {
    childOutput = await runProfileChild({ functionName, sentinel, serviceInstanceId })
    await delay(FLUSH_WAIT_MS)
    pollResult = await pollPyroscope({
      query,
      fromMs: startedAtMs - 5_000,
      functionName,
      sentinel,
    })
  } catch (err) {
    childError = err
    pollResult = {
      found: false,
      sentinelFunctionMatches: 0,
      sentinelTagMatches: 0,
      samples: 0,
      lastError: err,
    }
  }

  const ok = pollResult.found
  const result = resultFor({
    ok,
    sentinel,
    roundTripMs: Date.now() - startedAtMs,
    query,
    details: {
      service_instance_id: serviceInstanceId,
      sentinel_function: functionName,
      sentinel_function_found: pollResult.sentinelFunctionMatches > 0,
      sentinel_tag_found: pollResult.sentinelTagMatches > 0,
      sentinel_function_matches: pollResult.sentinelFunctionMatches,
      sentinel_tag_matches: pollResult.sentinelTagMatches,
      samples: pollResult.samples,
      ...(childOutput?.stderr ? { child_stderr: childOutput.stderr } : {}),
      ...(childError ? { child_error: childError.message } : {}),
      ...(pollResult.lastError && !ok ? { last_error: pollResult.lastError.message } : {}),
    },
  })

  const resultPath = await writeResult({ runDir, result })
  console.log(ok
    ? `profiles OK round_trip_ms=${result.round_trip_ms} result=${resultPath}`
    : `profiles FAIL timeout_ms=${POLL_TIMEOUT_MS} result=${resultPath}`)
  return ok
}

verifyProfiles()
  .then((ok) => process.exit(ok ? 0 : 1))
  .catch((err) => {
    console.error(err.message)
    process.exit(1)
  })
