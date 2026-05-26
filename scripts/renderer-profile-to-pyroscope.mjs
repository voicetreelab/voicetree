#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { convertV8CpuProfileToPprof } from '@vt/perf-analysis/v8-cpuprofile-to-pprof'

const PYROSCOPE_URL = process.env.PYROSCOPE_URL ?? 'http://localhost:2995'
const RENDERER_SERVICE = 'vt-renderer'

function usage() {
  return [
    'Usage: node scripts/renderer-profile-to-pyroscope.mjs <renderer.cpuprofile> <run-uuid>',
    '',
    'Converts a Chrome DevTools Protocol CPUProfile to pprof and uploads it',
    'to the local Pyroscope /ingest endpoint.',
  ].join('\n')
}

const unixSeconds = (ms) => Math.floor(ms / 1_000)

function pyroscopeLabelSet(labels) {
  return Object.entries(labels)
    .map(([key, value]) => {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`invalid Pyroscope label key: ${key}`)
      if (!/^[A-Za-z0-9_.:-]+$/.test(value)) throw new Error(`invalid Pyroscope label value for ${key}: ${value}`)
      return `${key}=${value}`
    })
    .join(',')
}

function renderIngestUrl({ runUuid, startedAtMs, stoppedAtMs }) {
  const url = new URL('/ingest', PYROSCOPE_URL)
  const from = unixSeconds(startedAtMs)
  const until = Math.max(from + 1, unixSeconds(stoppedAtMs))
  url.searchParams.set('name', `${RENDERER_SERVICE}{${pyroscopeLabelSet({ service_instance_id: runUuid })}}`)
  url.searchParams.set('from', String(from))
  url.searchParams.set('until', String(until))
  url.searchParams.set('spyName', 'nodespy')
  return url.toString()
}

function renderQuery(runUuid) {
  return `process_cpu:cpu:nanoseconds:cpu:nanoseconds{service_name="${RENDERER_SERVICE}",service_instance_id="${runUuid}"}`
}

async function uploadRendererProfile(cpuprofilePath, runUuid) {
  const resolvedPath = resolve(cpuprofilePath)
  const profile = JSON.parse(await readFile(resolvedPath, 'utf8'))
  const converted = convertV8CpuProfileToPprof(profile, { stoppedAtMs: Date.now() })
  const ingestUrl = renderIngestUrl({
    runUuid,
    startedAtMs: converted.summary.startedAtMs,
    stoppedAtMs: converted.summary.stoppedAtMs,
  })
  const formData = new FormData()
  formData.append('profile', new Blob([converted.pprofBuffer]), 'profile.pb')
  const response = await fetch(ingestUrl, {
    method: 'POST',
    body: formData,
    signal: AbortSignal.timeout(15_000),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Pyroscope ingest failed: HTTP ${response.status} ${body.trim()}`)
  }

  return {
    ok: true,
    cpuprofile_path: resolvedPath,
    service_instance_id: runUuid,
    posted_to: ingestUrl,
    render_query: renderQuery(runUuid),
    conversion: converted.summary,
  }
}

const [cpuprofilePath, runUuid] = process.argv.slice(2)

if (!cpuprofilePath || !runUuid) {
  process.stderr.write(`${usage()}\n`)
  process.exit(2)
}

try {
  const result = await uploadRendererProfile(cpuprofilePath, runUuid)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
} catch (err) {
  process.stderr.write(`renderer profile ingest failed: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
}
