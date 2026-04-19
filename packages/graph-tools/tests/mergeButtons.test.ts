import { describe, expect, it } from 'vitest'
import { mergeButtons, type ButtonCandidate, type RegistryButtonCandidate } from '../src/debug/mergeButtons'

const AX_BUTTONS: readonly ButtonCandidate[] = [
  {
    label: 'Close',
    selector: '#traffic-light-close',
    bbox: { x: 10, y: 20, w: 12, h: 12 },
    enabled: true,
  },
  {
    label: 'Run Agent',
    selector: '#run-agent',
    bbox: { x: 30, y: 20, w: 18, h: 18 },
    enabled: true,
  },
]

const REGISTRY_BUTTONS: readonly RegistryButtonCandidate[] = [
  {
    nodeId: 'node-a',
    label: 'Close (stale)',
    selector: '#traffic-light-close',
    bbox: { x: 0, y: 0, w: 1, h: 1 },
    enabled: false,
  },
  {
    nodeId: 'node-a',
    label: 'Add Child',
    selector: '#add-child',
    bbox: { x: 40, y: 20, w: 18, h: 18 },
    enabled: true,
  },
  {
    nodeId: 'node-b',
    label: 'Wrong Node',
    selector: '#wrong-node',
    bbox: { x: 50, y: 20, w: 18, h: 18 },
    enabled: true,
  },
]

describe('mergeButtons', () => {
  it('keeps AX buttons on selector conflicts and appends registry-only matches for the target node', () => {
    expect(mergeButtons(AX_BUTTONS, REGISTRY_BUTTONS, 'node-a')).toEqual([
      {
        label: 'Close',
        selector: '#traffic-light-close',
        bbox: { x: 10, y: 20, w: 12, h: 12 },
        enabled: true,
        source: 'ax',
      },
      {
        label: 'Run Agent',
        selector: '#run-agent',
        bbox: { x: 30, y: 20, w: 18, h: 18 },
        enabled: true,
        source: 'ax',
      },
      {
        label: 'Add Child',
        selector: '#add-child',
        bbox: { x: 40, y: 20, w: 18, h: 18 },
        enabled: true,
        source: 'registry',
      },
    ])
  })

  it('returns only registry buttons when AX has no visible matches', () => {
    expect(mergeButtons([], REGISTRY_BUTTONS, 'node-a')).toEqual([
      {
        label: 'Close (stale)',
        selector: '#traffic-light-close',
        bbox: { x: 0, y: 0, w: 1, h: 1 },
        enabled: false,
        source: 'registry',
      },
      {
        label: 'Add Child',
        selector: '#add-child',
        bbox: { x: 40, y: 20, w: 18, h: 18 },
        enabled: true,
        source: 'registry',
      },
    ])
  })
})
