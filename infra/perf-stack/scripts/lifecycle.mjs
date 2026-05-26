#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { closeSync, openSync } from 'node:fs'
import {
  access,
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const STACK_DIR = resolve(SCRIPT_DIR, '..')
const STORAGE_DIR = join(STACK_DIR, 'storage')
const PID_DIR = join(STORAGE_DIR, 'pids')
const LOG_DIR = join(STORAGE_DIR, 'logs')
const BIN_DIR = join(STACK_DIR, 'bin')
const CONFIG_DIR = join(STACK_DIR, 'config')
const GRAFANA_PROVISIONING_SOURCE_DIR = join(CONFIG_DIR, 'grafana/provisioning')
const GRAFANA_PROVISIONING_RUNTIME_DIR = join(STORAGE_DIR, 'grafana/provisioning')
const GRAFANA_DASHBOARDS_DIR = join(CONFIG_DIR, 'grafana/dashboards')

const SERVICES = [
  {
    name: 'loki',
    command: join(BIN_DIR, 'loki'),
    args: ['--config.file=infra/perf-stack/config/loki.yaml'],
    ready: 'http://127.0.0.1:2998/ready',
  },
  {
    name: 'tempo',
    command: join(BIN_DIR, 'tempo'),
    args: ['--config.file=infra/perf-stack/config/tempo.yaml'],
    ready: 'http://127.0.0.1:2997/ready',
  },
  {
    name: 'victoriametrics',
    command: join(BIN_DIR, 'victoriametrics'),
    args: [
      `-storageDataPath=${join(STORAGE_DIR, 'victoriametrics')}`,
      '-httpListenAddr=127.0.0.1:2996',
      '-retentionPeriod=1d',
      '-search.latencyOffset=0s',
    ],
    ready: 'http://127.0.0.1:2996/health',
  },
  {
    name: 'pyroscope',
    command: join(BIN_DIR, 'pyroscope'),
    args: [
      '--config.file=infra/perf-stack/config/pyroscope.yaml',
      '--segment-writer.lifecycler.addr=127.0.0.1',
      '--segment-writer.lifecycler.port=2991',
      '--segment-writer.store=inmemory',
    ],
    ready: 'http://127.0.0.1:2995/ready',
  },
  {
    name: 'grafana',
    command: join(BIN_DIR, 'grafana'),
    args: [
      'server',
      `--homepath=${join(BIN_DIR, 'grafana-home')}`,
      `--config=${join(CONFIG_DIR, 'grafana/grafana.ini')}`,
    ],
    env: {
      GF_PATHS_DATA: join(STORAGE_DIR, 'grafana/data'),
      GF_PATHS_LOGS: join(STORAGE_DIR, 'grafana/logs'),
      GF_PATHS_PLUGINS: join(STORAGE_DIR, 'grafana/plugins'),
      GF_PATHS_PROVISIONING: GRAFANA_PROVISIONING_RUNTIME_DIR,
    },
    ready: 'http://127.0.0.1:2999/api/health',
  },
  {
    name: 'otelcol-contrib',
    command: join(BIN_DIR, 'otelcol-contrib'),
    args: ['--config=file:infra/perf-stack/config/otelcol.yaml'],
    ready: 'http://127.0.0.1:13133/healthz',
  },
]

const BACKENDS = SERVICES.slice(0, 4)
const GRAFANA = SERVICES[4]
const OTELCOL = SERVICES[5]

const exists = async (path) => access(path).then(() => true, () => false)
const pidPath = (name) => join(PID_DIR, `${name}.pid`)
const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms))

const ensurePerfArtifactRoot = async () => {
  if (!process.env.HOME) throw new Error('HOME is required to create perf stack artifact directories')
  await mkdir(join(process.env.HOME, '.voicetree', 'perf'), { recursive: true })
}

const renderGrafanaProvisioning = async () => {
  await rm(GRAFANA_PROVISIONING_RUNTIME_DIR, { recursive: true, force: true })
  await mkdir(GRAFANA_PROVISIONING_RUNTIME_DIR, { recursive: true })
  await cp(GRAFANA_PROVISIONING_SOURCE_DIR, GRAFANA_PROVISIONING_RUNTIME_DIR, { recursive: true })

  const dashboardsYamlPath = join(GRAFANA_PROVISIONING_RUNTIME_DIR, 'dashboards/dashboards.yaml')
  const template = await readFile(dashboardsYamlPath, 'utf8')
  await writeFile(dashboardsYamlPath, template.replaceAll('__DASHBOARD_PATH__', GRAFANA_DASHBOARDS_DIR))
}

const readPid = async (name) => {
  try {
    const raw = await readFile(pidPath(name), 'utf8')
    const pid = Number(raw.trim())
    return Number.isInteger(pid) ? pid : undefined
  } catch {
    return undefined
  }
}

const isAlive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const ensureInstalled = async (service) => {
  if (!(await exists(service.command))) {
    throw new Error(`${service.name} binary missing at ${service.command}; run npm run perf:install`)
  }
}

const serviceEnv = (service) => {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key.startsWith('OTEL_')) delete env[key]
  }
  return {
    ...env,
    OTEL_SDK_DISABLED: 'true',
    ...(service.env ?? {}),
  }
}

const spawnService = async (service) => {
  await ensureInstalled(service)
  await mkdir(PID_DIR, { recursive: true })
  await mkdir(LOG_DIR, { recursive: true })

  const existingPid = await readPid(service.name)
  if (existingPid && isAlive(existingPid)) return existingPid

  const logFd = openSync(join(LOG_DIR, `${service.name}.log`), 'a')
  const child = spawn(service.command, service.args, {
    cwd: resolve(STACK_DIR, '../..'),
    detached: true,
    env: serviceEnv(service),
    stdio: ['ignore', logFd, logFd],
  })
  closeSync(logFd)
  child.unref()
  await writeFile(pidPath(service.name), `${child.pid}\n`)
  return child.pid
}

const ping = async (url) => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1000) })
    const body = await response.text().catch(() => '')
    return {
      ok: response.ok,
      status: response.status,
      body: body.trim().slice(0, 240),
    }
  } catch (err) {
    return { ok: false, status: 'ERR', body: err.message }
  }
}

const waitReady = async (service, timeoutMs = 30_000) => {
  const startedAt = Date.now()
  let last = { status: 'not-started', body: '' }
  while (Date.now() - startedAt < timeoutMs) {
    const pid = await readPid(service.name)
    if (pid && !isAlive(pid)) {
      throw new Error(`${service.name} exited before readiness; see ${join(LOG_DIR, `${service.name}.log`)}`)
    }
    last = await ping(service.ready)
    if (last.ok) return
    await delay(500)
  }
  throw new Error(`${service.name} readiness timed out at ${service.ready}; last=${last.status} ${last.body}`)
}

const startStack = async () => {
  await mkdir(STORAGE_DIR, { recursive: true })
  await Promise.all(BACKENDS.map(spawnService))
  await Promise.all(BACKENDS.map((service) => waitReady(service)))
  await renderGrafanaProvisioning()
  await spawnService(GRAFANA)
  await waitReady(GRAFANA)
  await ensurePerfArtifactRoot()
  await spawnService(OTELCOL)
  await waitReady(OTELCOL)
  console.log('Grafana ready at http://localhost:2999')
}

const stopPid = async (service, pid) => {
  if (!pid || !isAlive(pid)) return
  process.kill(pid, 'SIGTERM')
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return
    await delay(250)
  }
  if (isAlive(pid)) process.kill(pid, 'SIGKILL')
}

const wipeStorage = async () => {
  await mkdir(STORAGE_DIR, { recursive: true })
  for (const entry of await readdir(STORAGE_DIR)) {
    await rm(join(STORAGE_DIR, entry), { recursive: true, force: true })
  }
}

const stopStack = async ({ persist }) => {
  for (const service of [...SERVICES].reverse()) {
    const pid = await readPid(service.name)
    await stopPid(service, pid)
    await unlink(pidPath(service.name)).catch(() => {})
  }
  if (!persist) await wipeStorage()
}

const serviceStatus = async (service) => {
  const pid = await readPid(service.name)
  const alive = pid ? isAlive(pid) : false
  const readiness = alive ? await ping(service.ready) : { ok: false, status: 'NO_PID', body: '' }
  return { service, pid, alive, readiness }
}

const checkStack = async () => {
  const rows = await Promise.all(SERVICES.map(serviceStatus))
  console.log('service           pid       process   readiness')
  for (const row of rows) {
    console.log([
      row.service.name.padEnd(17),
      String(row.pid ?? '-').padEnd(9),
      (row.alive ? 'up' : 'down').padEnd(9),
      `${row.readiness.ok ? 'ok' : 'fail'} ${row.readiness.status}`.trim(),
    ].join(' '))
  }
  return rows.every((row) => row.alive && row.readiness.ok)
}

const openGrafana = async (runUuid) => {
  if (!(await checkStack())) await startStack()
  const suffix = runUuid ? `?var-run_id=${encodeURIComponent(runUuid)}` : ''
  const url = `http://localhost:2999${suffix}`
  if (process.platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref()
  } else {
    console.log(url)
  }
}

const main = async () => {
  const [command, ...args] = process.argv.slice(2)
  if (command === 'up') return startStack()
  if (command === 'down') return stopStack({ persist: args.includes('--persist') })
  if (command === 'check') {
    const ok = await checkStack()
    process.exit(ok ? 0 : 1)
  }
  if (command === 'view') return openGrafana(args[0])
  throw new Error('usage: lifecycle.mjs up | down [--persist] | check | view [run-uuid]')
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
