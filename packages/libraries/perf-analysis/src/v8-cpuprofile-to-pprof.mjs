import {
  Function as PprofFunction,
  Line,
  Location,
  Mapping,
  Profile,
  Sample,
  StringTable,
  ValueType,
} from 'pprof-format'

const MICROS_TO_NANOS = 1_000
const MILLIS_TO_NANOS = 1_000_000n
const DEFAULT_SAMPLE_PERIOD_NANOS = 1_000_000

const isObject = (value) => value !== null && typeof value === 'object'

const positiveFiniteNumber = (value) => Number.isFinite(value) && value > 0

const callFrameName = (callFrame = {}) => callFrame.functionName || '(anonymous)'

const callFrameUrl = (callFrame = {}) => callFrame.url || ''

const pprofLineNumber = (callFrame = {}) => {
  const lineNumber = Number.isInteger(callFrame.lineNumber) ? callFrame.lineNumber : 0
  return Math.max(1, lineNumber + 1)
}

function assertV8CpuProfile(profile) {
  if (!isObject(profile)) throw new Error('V8 CPU profile must be an object')
  if (!Array.isArray(profile.nodes) || profile.nodes.length === 0) {
    throw new Error('V8 CPU profile must contain a non-empty nodes array')
  }
}

function parentIdsByNodeId(nodes) {
  const parents = new Map()
  for (const node of nodes) {
    const children = Array.isArray(node.children) ? node.children : []
    for (const childId of children) parents.set(childId, node.id)
  }
  return parents
}

function stackForNodeId(nodeId, nodeById, parentById) {
  const stack = []
  const seen = new Set()
  let currentId = nodeId

  while (nodeById.has(currentId) && !seen.has(currentId)) {
    stack.push(currentId)
    seen.add(currentId)
    currentId = parentById.get(currentId)
  }

  return stack
}

function inferDurationMicros(profile) {
  const timeDeltas = Array.isArray(profile.timeDeltas) ? profile.timeDeltas : []
  const sampledDuration = timeDeltas.reduce((sum, value) => sum + (positiveFiniteNumber(value) ? value : 0), 0)
  if (sampledDuration > 0) return sampledDuration

  if (positiveFiniteNumber(profile.endTime) && positiveFiniteNumber(profile.startTime) && profile.endTime > profile.startTime) {
    return profile.endTime - profile.startTime
  }

  const hitCount = profile.nodes.reduce((sum, node) => sum + (positiveFiniteNumber(node.hitCount) ? node.hitCount : 0), 0)
  return hitCount > 0 ? hitCount * (DEFAULT_SAMPLE_PERIOD_NANOS / MICROS_TO_NANOS) : DEFAULT_SAMPLE_PERIOD_NANOS / MICROS_TO_NANOS
}

function inferSamplePeriodNanos(profile) {
  const positiveDeltas = (Array.isArray(profile.timeDeltas) ? profile.timeDeltas : [])
    .filter(positiveFiniteNumber)
    .sort((left, right) => left - right)

  if (positiveDeltas.length === 0) return DEFAULT_SAMPLE_PERIOD_NANOS
  return Math.round(positiveDeltas[Math.floor(positiveDeltas.length / 2)] * MICROS_TO_NANOS)
}

function resolveProfileWindow(profile, { startedAtMs, stoppedAtMs } = {}) {
  const durationMicros = inferDurationMicros(profile)
  const durationNanos = BigInt(Math.max(1, Math.round(durationMicros * MICROS_TO_NANOS)))
  const stopMs = positiveFiniteNumber(stoppedAtMs) ? stoppedAtMs : Date.now()
  const startMs = positiveFiniteNumber(startedAtMs) ? startedAtMs : stopMs - durationMicros / 1_000

  return {
    startedAtMs: startMs,
    stoppedAtMs: stopMs,
    durationNanos,
  }
}

function createPprofFrameTables(nodes, stringTable) {
  const mapping = new Mapping({
    id: 1,
    hasFunctions: true,
    hasFilenames: true,
    hasLineNumbers: true,
  })
  const functions = []
  const locations = []
  const locationIdByNodeId = new Map()

  nodes.forEach((node, index) => {
    const id = index + 1
    const callFrame = node.callFrame ?? {}
    const line = pprofLineNumber(callFrame)
    const fun = new PprofFunction({
      id,
      name: stringTable.dedup(callFrameName(callFrame)),
      systemName: stringTable.dedup(callFrameName(callFrame)),
      filename: stringTable.dedup(callFrameUrl(callFrame)),
      startLine: line,
    })
    const location = new Location({
      id,
      mappingId: mapping.id,
      line: [
        new Line({
          functionId: fun.id,
          line,
        }),
      ],
    })

    functions.push(fun)
    locations.push(location)
    locationIdByNodeId.set(node.id, location.id)
  })

  return {
    mapping,
    functions,
    locations,
    locationIdByNodeId,
  }
}

function sourceSamplesFromProfile(profile, nodeById, parentById, locationIdByNodeId) {
  const samples = Array.isArray(profile.samples) ? profile.samples : []
  const timeDeltas = Array.isArray(profile.timeDeltas) ? profile.timeDeltas : []

  if (samples.length > 0) {
    return samples.flatMap((nodeId, index) => {
      const value = Math.max(1, Math.round((timeDeltas[index] ?? 0) * MICROS_TO_NANOS))
      const locationIds = stackForNodeId(nodeId, nodeById, parentById)
        .map((stackNodeId) => locationIdByNodeId.get(stackNodeId))
        .filter((locationId) => locationId !== undefined)

      return locationIds.length > 0
        ? [{ locationIds, value }]
        : []
    })
  }

  return [...nodeById.values()].flatMap((node) => {
    if (!positiveFiniteNumber(node.hitCount)) return []

    const locationIds = stackForNodeId(node.id, nodeById, parentById)
      .map((stackNodeId) => locationIdByNodeId.get(stackNodeId))
      .filter((locationId) => locationId !== undefined)

    return locationIds.length > 0
      ? [{ locationIds, value: Math.round(node.hitCount * DEFAULT_SAMPLE_PERIOD_NANOS) }]
      : []
  })
}

export function convertV8CpuProfileToPprof(profile, options = {}) {
  assertV8CpuProfile(profile)

  const nodes = profile.nodes
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const parentById = parentIdsByNodeId(nodes)
  const stringTable = new StringTable()
  const periodType = new ValueType({
    type: stringTable.dedup('cpu'),
    unit: stringTable.dedup('nanoseconds'),
  })
  const sampleType = new ValueType({
    type: stringTable.dedup('cpu'),
    unit: stringTable.dedup('nanoseconds'),
  })
  const {
    mapping,
    functions,
    locations,
    locationIdByNodeId,
  } = createPprofFrameTables(nodes, stringTable)
  const sourceSamples = sourceSamplesFromProfile(profile, nodeById, parentById, locationIdByNodeId)

  if (sourceSamples.length === 0) throw new Error('V8 CPU profile has no usable samples or hit counts')

  const { startedAtMs, stoppedAtMs, durationNanos } = resolveProfileWindow(profile, options)
  const totalValueNanos = sourceSamples.reduce((sum, sample) => sum + BigInt(sample.value), 0n)
  const pprof = new Profile({
    sampleType: [sampleType],
    sample: sourceSamples.map((sample) => new Sample({
      locationId: sample.locationIds,
      value: [sample.value],
    })),
    mapping: [mapping],
    location: locations,
    function: functions,
    stringTable,
    timeNanos: BigInt(Math.round(startedAtMs)) * MILLIS_TO_NANOS,
    durationNanos,
    periodType,
    period: inferSamplePeriodNanos(profile),
    comment: [
      stringTable.dedup('converted from Chrome DevTools Protocol Profiler.stop CPUProfile'),
    ],
  })
  const pprofBuffer = pprof.encode()

  return {
    pprofBuffer,
    summary: {
      startedAtMs,
      stoppedAtMs,
      durationNanos: durationNanos.toString(),
      sampleCount: sourceSamples.length,
      totalValueNanos: totalValueNanos.toString(),
      functionCount: functions.length,
    },
  }
}
