import { Profile } from 'pprof-format'
import { describe, expect, test } from 'vitest'
import { convertV8CpuProfileToPprof } from '../src/v8-cpuprofile-to-pprof.mjs'

function syntheticProfile() {
  return {
    nodes: [
      {
        id: 1,
        callFrame: { functionName: '(root)', url: '', lineNumber: 0 },
        children: [2],
      },
      {
        id: 2,
        callFrame: { functionName: 'renderBoard', url: 'file:///renderer.js', lineNumber: 9 },
        children: [3],
      },
      {
        id: 3,
        callFrame: { functionName: 'layoutNodes', url: 'file:///renderer.js', lineNumber: 19 },
      },
    ],
    samples: [2, 3, 3],
    timeDeltas: [1_000, 2_000, 3_000],
    startTime: 10_000,
    endTime: 16_000,
  }
}

const stringAt = (profile, index) => profile.stringTable.strings[Number(index)]

describe('v8 cpuprofile to pprof conversion', () => {
  test('preserves sample count and total sampled CPU nanoseconds', () => {
    const converted = convertV8CpuProfileToPprof(syntheticProfile(), {
      startedAtMs: 1_700_000_000_000,
      stoppedAtMs: 1_700_000_006_000,
    })
    const decoded = Profile.decode(converted.pprofBuffer)

    const totalValue = decoded.sample.reduce((sum, sample) => sum + BigInt(sample.value[0]), 0n)

    expect(decoded.sample).toHaveLength(3)
    expect(converted.summary.sampleCount).toBe(3)
    expect(totalValue).toBe(6_000_000n)
    expect(converted.summary.totalValueNanos).toBe('6000000')
  })

  test('keeps the leaf frame first in each pprof sample stack', () => {
    const converted = convertV8CpuProfileToPprof(syntheticProfile())
    const decoded = Profile.decode(converted.pprofBuffer)
    const lastSample = decoded.sample[2]
    const leafLocation = decoded.location.find((location) => location.id === lastSample.locationId[0])
    const leafLine = leafLocation.line[0]
    const leafFunction = decoded.function.find((fn) => fn.id === leafLine.functionId)

    expect(stringAt(decoded, leafFunction.name)).toBe('layoutNodes')
  })

  test('rejects profiles with no usable samples', () => {
    expect(() => convertV8CpuProfileToPprof({ nodes: [{ id: 1, callFrame: {} }] }))
      .toThrow('no usable samples')
  })
})
