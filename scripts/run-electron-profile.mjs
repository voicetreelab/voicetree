#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_OTLP_ENDPOINT = 'http://localhost:2994'
const GRAFANA_RUNS_DASHBOARD = 'http://localhost:2999/d/vt-runs/vt-runs'

function resolveRunUuid(env = process.env) {
  return env.VOICETREE_RUN_INSTANCE_ID && env.VOICETREE_RUN_INSTANCE_ID.length > 0
    ? env.VOICETREE_RUN_INSTANCE_ID
    : randomUUID()
}

function parseArgs(argv) {
  const passthrough = []
  let otlpEnabled = true

  for (const arg of argv) {
    if (arg === '--no-otlp') {
      otlpEnabled = false
    } else if (arg === '--help' || arg === '-h') {
      return { kind: 'help' }
    } else {
      passthrough.push(arg)
    }
  }

  return { kind: 'run', otlpEnabled, passthrough }
}

function grafanaRunUrl(runUuid) {
  const url = new URL(GRAFANA_RUNS_DASHBOARD)
  url.searchParams.set('var-run_id', runUuid)
  return url.toString()
}

function artifactDir(runUuid) {
  return join(homedir(), '.voicetree', 'perf', runUuid)
}

function profileEnv({ baseEnv = process.env, runUuid, otlpEnabled }) {
  const env = {
    ...baseEnv,
    VOICETREE_RUN_INSTANCE_ID: runUuid,
    VOICETREE_PERF_PROFILE: '1',
  }

  if (otlpEnabled) {
    env.VOICETREE_OTLP_ENDPOINT = baseEnv.VOICETREE_OTLP_ENDPOINT && baseEnv.VOICETREE_OTLP_ENDPOINT.length > 0
      ? baseEnv.VOICETREE_OTLP_ENDPOINT
      : DEFAULT_OTLP_ENDPOINT
  } else {
    delete env.VOICETREE_OTLP_ENDPOINT
  }

  return env
}

function printHelp() {
  process.stdout.write([
    'Usage: npm run electron:profile -- [electron-main-storm args]',
    '',
    'Profiles the Electron main-storm harness with VOICETREE_PERF_PROFILE=1.',
    'By default it verifies the local perf stack, stamps VOICETREE_RUN_INSTANCE_ID,',
    `and exports VOICETREE_OTLP_ENDPOINT=${DEFAULT_OTLP_ENDPOINT}.`,
    '',
    'Options:',
    '  --no-otlp  run the Electron scenario without checking or exporting OTLP',
    '  -h, --help show this help',
    '',
  ].join('\n'))
}

function runCommand(command, args, options = {}) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => {
      stdout += chunk
      options.onStdout?.(String(chunk))
    })
    child.stderr?.on('data', (chunk) => {
      stderr += chunk
      options.onStderr?.(String(chunk))
    })
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      resolveCommand({ code, signal, stdout, stderr })
    })
  })
}

async function assertPerfStackUp(env) {
  const result = await runCommand('npm', ['run', 'perf:check'], { env })
  if (result.code !== 0) {
    throw new Error([
      'perf stack is not ready; run `npm run perf:up` first, then retry `npm run electron:profile`',
      result.stdout.trim(),
      result.stderr.trim(),
    ].filter(Boolean).join('\n'))
  }
}

function printRunHeader({ runUuid, otlpEnabled, env }) {
  process.stdout.write(`Electron perf run: ${runUuid}\n`)
  process.stdout.write(`Grafana: ${grafanaRunUrl(runUuid)}\n`)
  process.stdout.write(`Artifacts: ${artifactDir(runUuid)}\n`)
  process.stdout.write(
    otlpEnabled
      ? `OTLP: ${env.VOICETREE_OTLP_ENDPOINT}\n`
      : 'OTLP: disabled (--no-otlp); perf stack export skipped\n',
  )
}

async function runElectronProfile({ passthrough, env }) {
  return await runCommand('npm', ['run', 'perf:main-storm:local', '--', ...passthrough], {
    env,
    stdio: 'inherit',
  })
}

async function main(argv = process.argv.slice(2), baseEnv = process.env) {
  const parsed = parseArgs(argv)
  if (parsed.kind === 'help') {
    printHelp()
    return 0
  }

  const runUuid = resolveRunUuid(baseEnv)
  const env = profileEnv({
    baseEnv,
    runUuid,
    otlpEnabled: parsed.otlpEnabled,
  })

  printRunHeader({ runUuid, otlpEnabled: parsed.otlpEnabled, env })

  if (parsed.otlpEnabled) {
    await assertPerfStackUp(env)
  }

  const result = await runElectronProfile({ passthrough: parsed.passthrough, env })
  if (result.signal) {
    process.kill(process.pid, result.signal)
    return 1
  }
  return result.code ?? 1
}

const isEntrypoint = import.meta.url === pathToFileURL(process.argv[1]).href
if (isEntrypoint) {
  main().then(
    (code) => {
      process.exitCode = code
    },
    (err) => {
      process.stderr.write(`electron profile failed: ${err instanceof Error ? err.message : String(err)}\n`)
      process.exitCode = 1
    },
  )
}
