#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const SIGNALS = [
  { name: 'logs', backend: 'loki:2998' },
  { name: 'metrics', backend: 'victoriametrics:2996' },
  { name: 'traces', backend: 'tempo:2997' },
  { name: 'profiles', backend: 'pyroscope:2995' },
]

const exists = async (path) => access(path).then(() => true, () => false)
const verifyDirFor = (runUuid) => join(homedir(), '.voicetree', 'perf', runUuid, 'verify')
const resultPathFor = ({ runUuid, signal }) => join(verifyDirFor(runUuid), `${signal}.json`)

const runUuid = process.env.VOICETREE_RUN_INSTANCE_ID ?? randomUUID()

const runScript = async ({ name }) => {
  const path = join(SCRIPT_DIR, `verify-${name}.mjs`)
  if (!(await exists(path))) {
    return { signal: name, exitCode: 1, stdout: '', stderr: `missing verify script: ${path}` }
  }

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path], {
      env: {
        ...process.env,
        VOICETREE_RUN_INSTANCE_ID: runUuid,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (err) => {
      resolve({ signal: name, exitCode: 1, stdout, stderr: `${stderr}${err.message}` })
    })
    child.on('exit', (code) => {
      resolve({ signal: name, exitCode: code ?? 1, stdout, stderr })
    })
  })
}

const readSignalJson = async ({ runUuid, signal }) => {
  const path = resultPathFor({ runUuid, signal })
  try {
    return {
      path,
      result: JSON.parse(await readFile(path, 'utf8')),
    }
  } catch (err) {
    return {
      path,
      readError: err instanceof Error ? err.message : String(err),
    }
  }
}

const formatRoundTrip = (ms) => (
  Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)}s` : 'n/a'
)

const summarize = ({ spec, child, json }) => {
  const ok = child.exitCode === 0 && json.result?.ok === true
  return {
    signal: spec.name,
    backend: spec.backend,
    ok,
    roundTripMs: json.result?.round_trip_ms,
    failure: {
      exitCode: child.exitCode,
      jsonPath: json.path,
      readError: json.readError,
      stdout: child.stdout.trim(),
      stderr: child.stderr.trim(),
    },
  }
}

const childResults = await Promise.all(SIGNALS.map(runScript))
const jsonResults = await Promise.all(SIGNALS.map((spec) => readSignalJson({
  runUuid,
  signal: spec.name,
})))
const summaries = SIGNALS.map((spec, index) => summarize({
  spec,
  child: childResults[index],
  json: jsonResults[index],
}))

for (const summary of summaries) {
  console.log([
    summary.ok ? '✓' : '✗',
    summary.signal.padEnd(10),
    'round-trip',
    formatRoundTrip(summary.roundTripMs).padEnd(6),
    `backend=${summary.backend}`,
  ].join(' '))
}

const successes = summaries.filter((summary) => summary.ok)
if (successes.length === SIGNALS.length) {
  console.log(`all ${SIGNALS.length} signals OK · results at ~/.voicetree/perf/${runUuid}/verify/`)
  process.exit(0)
}

const failures = summaries.filter((summary) => !summary.ok)
console.log(`${successes.length}/${SIGNALS.length} signals OK; failures: [${failures.map((failure) => failure.signal).join(', ')}]`)

for (const failure of failures) {
  if (failure.failure.readError) {
    console.error(`${failure.signal}: could not read ${failure.failure.jsonPath}: ${failure.failure.readError}`)
  }
  if (failure.failure.stdout) {
    console.error(`${failure.signal} stdout:\n${failure.failure.stdout}`)
  }
  if (failure.failure.stderr) {
    console.error(`${failure.signal} stderr:\n${failure.failure.stderr}`)
  }
}

process.exit(1)
