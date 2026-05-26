#!/usr/bin/env node
import { writeFile } from 'node:fs/promises'
import { Profile, StringTable, emptyTableToken } from 'pprof-format'

const DEFAULT_PYROSCOPE_URL = 'http://127.0.0.1:2995'
const SELECT_MERGE_PROFILE_PATH = '/querier.v1.QuerierService/SelectMergeProfile'
const INTEGER = /^-?\d+$/
const RELATIVE_TIME = /^now-(\d+)([smhdw])$/
const UNIT_MS = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
}

const usage = () => `Usage:
  node infra/perf-stack/scripts/export-pyroscope-pprof.mjs \\
    --profile-type wall:cpu:nanoseconds:wall:nanoseconds \\
    --selector '{service_name="vt-graphd",service_instance_id="<run-id>"}' \\
    --from now-24h --until now --out /tmp/profile.pb

Options:
  --pyroscope-url <url>  Default: ${DEFAULT_PYROSCOPE_URL}
  --profile-type <id>   Pyroscope profile type ID.
  --selector <selector> Pyroscope label selector.
  --from <time>         now, now-24h, epoch seconds, or epoch milliseconds.
  --until <time>        now, now-24h, epoch seconds, or epoch milliseconds. Default: now.
  --out <path>          Output binary pprof path.
`

const parseArgs = (argv) => {
  const result = {
    pyroscopeUrl: DEFAULT_PYROSCOPE_URL,
    until: 'now',
  }
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]
    const value = argv[i + 1]
    if (!key.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new Error(`invalid argument near ${key}\n${usage()}`)
    }
    i += 1
    if (key === '--pyroscope-url') result.pyroscopeUrl = value
    else if (key === '--profile-type') result.profileTypeID = value
    else if (key === '--selector') result.labelSelector = value
    else if (key === '--from') result.from = value
    else if (key === '--until') result.until = value
    else if (key === '--out') result.out = value
    else throw new Error(`unknown option ${key}\n${usage()}`)
  }

  for (const [key, value] of Object.entries({
    '--profile-type': result.profileTypeID,
    '--selector': result.labelSelector,
    '--from': result.from,
    '--out': result.out,
  })) {
    if (!value) throw new Error(`missing ${key}\n${usage()}`)
  }
  return result
}

const parseTimeMs = (value, nowMs = Date.now()) => {
  if (value === 'now') return nowMs
  const relative = RELATIVE_TIME.exec(value)
  if (relative) return nowMs - Number(relative[1]) * UNIT_MS[relative[2]]
  if (INTEGER.test(value)) {
    const numeric = Number(value)
    return numeric < 10_000_000_000 ? numeric * 1_000 : numeric
  }
  throw new Error(`unsupported time value ${value}`)
}

const buildSelectMergeProfileRequest = ({ from, until, labelSelector, profileTypeID }, nowMs = Date.now()) => ({
  start: parseTimeMs(from, nowMs),
  end: parseTimeMs(until, nowMs),
  labelSelector,
  profileTypeID,
})

const stringTableFrom = (strings = []) => {
  const table = new StringTable(emptyTableToken)
  for (const value of strings) table.dedup(value)
  return table
}

const normalizeProfileJson = (value, key) => {
  if (key === 'stringTable') return stringTableFrom(value)
  if (Array.isArray(value)) return value.map((item) => normalizeProfileJson(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [entryKey, normalizeProfileJson(entryValue, entryKey)]),
    )
  }
  if (typeof value === 'string' && INTEGER.test(value)) return BigInt(value)
  return value
}

const profileJsonToPprofBuffer = (profileJson) => Buffer.from(new Profile(normalizeProfileJson(profileJson)).encode())

const selectMergeProfile = async ({ pyroscopeUrl, request }) => {
  const response = await fetch(new URL(SELECT_MERGE_PROFILE_PATH, pyroscopeUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Pyroscope SelectMergeProfile failed: ${response.status} ${body.trim()}`)
  }
  return response.json()
}

const main = async () => {
  const args = parseArgs(process.argv.slice(2))
  const request = buildSelectMergeProfileRequest(args)
  const profileJson = await selectMergeProfile({ pyroscopeUrl: args.pyroscopeUrl, request })
  const pprofBuffer = profileJsonToPprofBuffer(profileJson)
  await writeFile(args.out, pprofBuffer)
  console.log(JSON.stringify({
    out: args.out,
    bytes: pprofBuffer.length,
    samples: profileJson.sample?.length ?? 0,
    functions: profileJson.function?.length ?? 0,
    locations: profileJson.location?.length ?? 0,
  }))
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
