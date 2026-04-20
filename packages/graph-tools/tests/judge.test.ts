import { describe, expect, it } from 'vitest'
import { buildJudgePrompt, parseJudgeResponse, type FlowBundle, type JudgeVerdict } from '../src/debug/judge'

const MINIMAL_BUNDLE: FlowBundle = {
  flowId: 'F1',
  title: 'Bootstrap graph render and fit',
  intent: 'Confirm the mounted graph shell renders and can execute a viewport fit without crashing.',
  judgeFocus: [
    'Sidebar shell renders instead of the blank project-selection or blank-root state.',
    'State snapshots keep a non-empty loaded root set before and after RequestFit.',
  ],
  steps: [
    { waitFor: '.sidebar-wrapper', timeoutMs: 2000 },
    { dispatch: { type: 'RequestFit', paddingPx: 24 } },
    { wait: 300 },
  ],
  scoreboardRow: {
    pass: false,
    reason: '0/3 runs passed; step 1 failed: TimeoutError',
    runs: [false, false, false],
  },
  runSummaries: [
    {
      runIndex: 1,
      pass: false,
      stepOutputs: [
        {
          stepIndex: 0,
          step: { waitFor: '.sidebar-wrapper', timeoutMs: 2000 },
          ok: false,
          error: 'TimeoutError: page.waitForSelector: Timeout 2000ms exceeded.',
          screenshotPath: '/tmp/vt-debug/flows/F1-123/run-01/step-01.png',
          stateGraphNodeCount: 2,
          stateRootsLoaded: ['/path/to/root'],
          domProbes: {
            cyNodeCount: 27,
            floatingEditors: ['window-node-a-editor'],
            selectedNodeHasEditor: false,
          },
        },
      ],
    },
  ],
}

describe('buildJudgePrompt', () => {
  it('includes flow id and title', () => {
    const prompt = buildJudgePrompt(MINIMAL_BUNDLE)
    expect(prompt).toContain('F1')
    expect(prompt).toContain('Bootstrap graph render and fit')
  })

  it('includes intent', () => {
    const prompt = buildJudgePrompt(MINIMAL_BUNDLE)
    expect(prompt).toContain('Confirm the mounted graph shell renders')
  })

  it('includes all judge focus points', () => {
    const prompt = buildJudgePrompt(MINIMAL_BUNDLE)
    expect(prompt).toContain('Sidebar shell renders')
    expect(prompt).toContain('State snapshots keep a non-empty loaded root set')
  })

  it('includes step count in verdict instructions', () => {
    const prompt = buildJudgePrompt(MINIMAL_BUNDLE)
    expect(prompt).toContain('exactly 3 entries')
  })

  it('includes mechanical result', () => {
    const prompt = buildJudgePrompt(MINIMAL_BUNDLE)
    expect(prompt).toContain('FAIL')
    expect(prompt).toContain('0/3 runs passed')
  })

  it('includes run evidence with error', () => {
    const prompt = buildJudgePrompt(MINIMAL_BUNDLE)
    expect(prompt).toContain('TimeoutError')
  })

  it('includes domProbes blocks when present', () => {
    const prompt = buildJudgePrompt(MINIMAL_BUNDLE)
    expect(prompt).toContain('Dom probes:')
    expect(prompt).toContain('"cyNodeCount": 27')
    expect(prompt).toContain('"floatingEditors"')
    expect(prompt).toContain('"selectedNodeHasEditor": false')
  })

  it('includes screenshot paths before the mechanical result section', () => {
    const screenshotBundle: FlowBundle = {
      ...MINIMAL_BUNDLE,
      runSummaries: [
        {
          runIndex: 1,
          pass: false,
          stepOutputs: [
            {
              stepIndex: 0,
              step: { waitFor: '.sidebar-wrapper', timeoutMs: 2000 },
              ok: true,
              screenshotPath: '/tmp/vt-debug/flows/F1-123/run-01/step-01.png',
            },
            {
              stepIndex: 1,
              step: { dispatch: { type: 'RequestFit', paddingPx: 24 } },
              ok: true,
              screenshotPath: '/tmp/vt-debug/flows/F1-123/run-01/step-02.png',
            },
          ],
        },
      ],
    }
    const prompt = buildJudgePrompt(screenshotBundle)
    const screenshotsIndex = prompt.indexOf('## Step screenshots (read via file path')
    const mechanicalIndex = prompt.indexOf('## Mechanical Result')

    expect(screenshotsIndex).toBeGreaterThan(-1)
    expect(screenshotsIndex).toBeLessThan(mechanicalIndex)
    expect(prompt).toContain('### Run 1')
    expect(prompt).toContain('step-01: /tmp/vt-debug/flows/F1-123/run-01/step-01.png')
    expect(prompt).toContain('step-02: /tmp/vt-debug/flows/F1-123/run-01/step-02.png')
  })

  it('includes JSON schema shape in prompt', () => {
    const prompt = buildJudgePrompt(MINIMAL_BUNDLE)
    expect(prompt).toContain('"pass": boolean')
    expect(prompt).toContain('"per_step"')
    expect(prompt).toContain('"overall_reason"')
  })

  it('produces a passing prompt for a passing bundle', () => {
    const passingBundle: FlowBundle = {
      ...MINIMAL_BUNDLE,
      scoreboardRow: { pass: true, reason: '3/3 runs passed', runs: [true, true, true] },
      runSummaries: [
        {
          runIndex: 1,
          pass: true,
          stepOutputs: [{ stepIndex: 0, step: { wait: 100 }, ok: true }],
        },
      ],
    }
    const prompt = buildJudgePrompt(passingBundle)
    expect(prompt).toContain('PASS')
    expect(prompt).toContain('3/3 runs passed')
  })
})

describe('parseJudgeResponse', () => {
  const validVerdict: JudgeVerdict = {
    pass: true,
    per_step: [
      { step: 1, pass: true, reason: 'sidebar rendered correctly' },
      { step: 2, pass: true, reason: 'fit dispatched without error' },
      { step: 3, pass: true, reason: 'state stable after wait' },
    ],
    overall_reason: 'All steps completed with correct semantic outcomes.',
  }

  it('parses a clean JSON response', () => {
    const result = parseJudgeResponse(JSON.stringify(validVerdict))
    expect(result.pass).toBe(true)
    expect(result.per_step).toHaveLength(3)
    expect(result.overall_reason).toBe('All steps completed with correct semantic outcomes.')
  })

  it('extracts JSON embedded in prose', () => {
    const prose = `Here is my verdict:\n${JSON.stringify(validVerdict)}\nThank you.`
    const result = parseJudgeResponse(prose)
    expect(result.pass).toBe(true)
  })

  it('throws on empty response', () => {
    expect(() => parseJudgeResponse('')).toThrow('no JSON object found')
  })

  it('throws on invalid schema (missing per_step)', () => {
    const bad = JSON.stringify({ pass: true, overall_reason: 'ok' })
    expect(() => parseJudgeResponse(bad)).toThrow('does not match JudgeVerdict schema')
  })

  it('throws on non-boolean pass field', () => {
    const bad = JSON.stringify({ pass: 'yes', per_step: [], overall_reason: 'ok' })
    expect(() => parseJudgeResponse(bad)).toThrow('does not match JudgeVerdict schema')
  })

  it('parses a failing verdict', () => {
    const failing: JudgeVerdict = {
      pass: false,
      per_step: [{ step: 1, pass: false, reason: 'sidebar not visible' }],
      overall_reason: 'UI did not mount — blank canvas state.',
    }
    const result = parseJudgeResponse(JSON.stringify(failing))
    expect(result.pass).toBe(false)
    expect(result.per_step[0]?.pass).toBe(false)
  })
})
