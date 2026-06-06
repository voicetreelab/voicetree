import { describe, expect, it } from 'vitest'
import { runGracefulShutdown, type ShutdownStep } from '../lifecycle/gracefulShutdown.ts'

type Harness = {
  readonly order: string[]
  readonly issues: Array<{ label: string; message: string }>
  readonly exitCodes: number[]
}

function makeHarness(): Harness {
  return { exitCodes: [], issues: [], order: [] }
}

const never = (): Promise<void> => new Promise<void>(() => {})

describe('runGracefulShutdown', () => {
  it('runs every step in order and exits 0 exactly once', async () => {
    const h = makeHarness()
    const steps: ShutdownStep[] = [
      { label: 'a', run: () => void h.order.push('a') },
      { label: 'b', run: () => void h.order.push('b') },
      { label: 'c', run: () => void h.order.push('c') },
    ]
    await runGracefulShutdown({
      steps,
      stepTimeoutMs: 1000,
      hardDeadlineMs: 5000,
      onStepIssue: (label, error) => h.issues.push({ label, message: error.message }),
      exit: (code) => h.exitCodes.push(code),
    })

    expect(h.order).toEqual(['a', 'b', 'c'])
    expect(h.issues).toEqual([])
    expect(h.exitCodes).toEqual([0])
  })

  it('a throwing step is reported but does not block the remaining steps', async () => {
    const h = makeHarness()
    await runGracefulShutdown({
      steps: [
        { label: 'before', run: () => void h.order.push('before') },
        { label: 'boom', run: () => { throw new Error('kaboom') } },
        { label: 'after', run: () => void h.order.push('after') },
      ],
      stepTimeoutMs: 1000,
      hardDeadlineMs: 5000,
      onStepIssue: (label, error) => h.issues.push({ label, message: error.message }),
      exit: (code) => h.exitCodes.push(code),
    })

    expect(h.order).toEqual(['before', 'after'])
    expect(h.issues).toEqual([{ label: 'boom', message: 'kaboom' }])
    expect(h.exitCodes).toEqual([0])
  })

  it('a HANGING step is abandoned after the step timeout so later steps still run and the process still exits', async () => {
    const h = makeHarness()
    await runGracefulShutdown({
      steps: [
        // Simulates the real bug: an await (HTTP/OTLP close) that never resolves.
        { label: 'wedged', run: never },
        // The critical cleanup that must still run despite the hang.
        { label: 'unlink-rpc-port', run: () => void h.order.push('unlink-rpc-port') },
      ],
      stepTimeoutMs: 30,
      hardDeadlineMs: 5000,
      onStepIssue: (label, error) => h.issues.push({ label, message: error.message }),
      exit: (code) => h.exitCodes.push(code),
    })

    expect(h.order).toEqual(['unlink-rpc-port'])
    expect(h.issues).toHaveLength(1)
    expect(h.issues[0]?.label).toBe('wedged')
    expect(h.issues[0]?.message).toContain('timed out')
    expect(h.exitCodes).toEqual([0])
  })

  it('hard deadline forces exit(1) when the whole sequence wedges, and exit fires at most once', async () => {
    const h = makeHarness()
    await runGracefulShutdown({
      // Both steps hang; their step-timeouts (50ms each) exceed the 30ms hard
      // deadline, so the backstop fires before they individually resolve.
      steps: [
        { label: 'wedged-1', run: never },
        { label: 'wedged-2', run: never },
      ],
      stepTimeoutMs: 50,
      hardDeadlineMs: 30,
      onStepIssue: (label, error) => h.issues.push({ label, message: error.message }),
      exit: (code) => h.exitCodes.push(code),
    })

    expect(h.exitCodes).toEqual([1])
    expect(h.issues.some((i) => i.label === '<hard-deadline>')).toBe(true)
  })
})
