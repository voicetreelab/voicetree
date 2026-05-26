#!/usr/bin/env node
import { access } from 'node:fs/promises'
import { resolve } from 'node:path'

const PYROSCOPE_URL = 'http://localhost:4040'
const RENDERER_SERVICE = 'vt-renderer'

function usage() {
  return [
    'Usage: node scripts/renderer-profile-to-pyroscope.mjs <renderer.cpuprofile> <run-uuid>',
    '',
    'This is an honest Phase 4.6 stub: the repository has no renderer CDP',
    'or V8 cpuprofile-to-pprof pipeline to safely ingest renderer profiles yet.',
  ].join('\n')
}

function renderIngestUrl(runUuid) {
  const url = new URL('/ingest', PYROSCOPE_URL)
  url.searchParams.set('name', `${RENDERER_SERVICE}{service_instance_id=${runUuid}}`)
  url.searchParams.set('spyName', 'nodespy')
  return url.toString()
}

async function describeStub(cpuprofilePath, runUuid) {
  const resolvedPath = resolve(cpuprofilePath)
  await access(resolvedPath)
  return {
    ok: false,
    reason: 'renderer Pyroscope ingest is not implemented: no safe V8 cpuprofile-to-pprof converter exists in this repository',
    cpuprofile_path: resolvedPath,
    service_instance_id: runUuid,
    would_post_to: renderIngestUrl(runUuid),
  }
}

const [cpuprofilePath, runUuid] = process.argv.slice(2)

if (!cpuprofilePath || !runUuid) {
  process.stderr.write(`${usage()}\n`)
  process.exit(2)
}

try {
  const result = await describeStub(cpuprofilePath, runUuid)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  process.exit(1)
} catch (err) {
  process.stderr.write(`renderer profile stub failed: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
}
