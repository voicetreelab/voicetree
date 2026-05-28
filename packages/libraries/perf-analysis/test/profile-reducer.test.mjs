import { Session } from 'node:inspector/promises'
import { describe, expect, test } from 'vitest'
import { flattenCpuProfile, topK } from '../src/profile-reducer.mjs'

function syntheticProfile() {
  return {
    nodes: [
      { id: 1, callFrame: { functionName: '(program)', url: '', lineNumber: 0 } },
      { id: 2, callFrame: { functionName: '(idle)', url: '', lineNumber: 0 } },
      { id: 3, callFrame: { functionName: '(garbage collector)', url: '', lineNumber: 0 } },
      { id: 4, callFrame: { functionName: 'heaviestUserCode', url: 'file:///fixture.mjs', lineNumber: 10 } },
      { id: 5, callFrame: { functionName: 'lighterUserCode', url: 'file:///fixture.mjs', lineNumber: 20 } },
    ],
    samples: [1, 2, 3, 4, 4, 5],
    timeDeltas: [100, 100, 100, 700, 300, 250],
  }
}

function heaviestUserCode() {
  let total = 0
  for (let i = 0; i < 5_000_000; i++) total += Math.sqrt(i)
  return total
}

function lighterUserCode() {
  let total = 0
  for (let i = 0; i < 50_000; i++) total += Math.cbrt(i)
  return total
}

async function capturedProfile() {
  const session = new Session()
  session.connect()
  await session.post('Profiler.enable')
  await session.post('Profiler.start')

  let guard = 0
  while (guard < 12) {
    heaviestUserCode()
    lighterUserCode()
    guard += 1
  }

  const { profile } = await session.post('Profiler.stop')
  session.disconnect()
  return profile
}

describe('profile reducer', () => {
  test('ranks the heaviest user-code function from a captured cpuprofile', async () => {
    const profile = await capturedProfile()

    const ranked = topK(flattenCpuProfile(profile), 10)

    expect(ranked[0][0]).toContain('heaviestUserCode@')
  })

  test('excludes V8 pseudo-frames by default', () => {
    const keys = topK(flattenCpuProfile(syntheticProfile())).map(([key]) => key)

    expect(keys.some((key) => key.startsWith('(idle)@'))).toBe(false)
    expect(keys.some((key) => key.startsWith('(program)@'))).toBe(false)
    expect(keys.some((key) => key.startsWith('(garbage collector)@'))).toBe(false)
  })

  test('includes V8 pseudo-frames when explicitly requested', () => {
    const keys = topK(flattenCpuProfile(syntheticProfile(), { includePseudo: true })).map(([key]) => key)

    expect(keys.some((key) => key.startsWith('(idle)@'))).toBe(true)
    expect(keys.some((key) => key.startsWith('(program)@'))).toBe(true)
    expect(keys.some((key) => key.startsWith('(garbage collector)@'))).toBe(true)
  })
})
