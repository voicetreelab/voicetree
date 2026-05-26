import { loadProjection, loadSnapshot, type State } from '@vt/graph-state'

import { computeDrift } from '../../src/debug/state/drift'
import { elementSpecToCyDump, projectStateToCyDump } from '../../src/debug/state/projectedCyDump'
import {
  classifyDriftReport,
} from '../../src/debug/stress/divergenceClass'
import { RECORDED_STATE_FIXTURE_IDS } from '../../src/debug/stress/stressSpec'

import type { RecordedFixtureResult } from './types'

function snapshotFsContentById(state: State): Record<string, string> {
  return Object.fromEntries(
    Object.entries(state.graph.nodes).map(([nodeId, node]) => [nodeId, node.contentWithoutYamlOrLinks]),
  )
}

export async function runRecordedFixtureReplay(): Promise<RecordedFixtureResult[]> {
  const results: RecordedFixtureResult[] = []

  for (const fixtureId of RECORDED_STATE_FIXTURE_IDS) {
    const state = loadSnapshot(fixtureId)
    const expectedProjection = loadProjection(fixtureId)
    const report = computeDrift(
      {
        ...state,
        fsContentById: snapshotFsContentById(state),
      },
      projectStateToCyDump(state),
      elementSpecToCyDump(expectedProjection, state),
    )

    results.push({
      fixtureId,
      projectionVsRenderedEqual: report.projectionVsRendered.equal,
      classIds: classifyDriftReport(report),
      report,
    })
  }

  return results
}
