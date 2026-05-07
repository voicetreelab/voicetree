import type { DriftReport, Divergence } from '../drift'

export const DIVERGENCE_CLASS_BASELINE_SCHEMA = 'vt-debug/divergence-class-baseline@1'

export interface DivergenceClassBaseline {
  readonly $schema: typeof DIVERGENCE_CLASS_BASELINE_SCHEMA
  readonly description: string
  readonly classIds: readonly string[]
}

type DriftScope = 'dataVsProjection' | 'projectionVsRendered'

const MISSING_CLASS_SUFFIX: Record<DriftScope, { missingInA: string; missingInB: string }> = {
  dataVsProjection: {
    missingInA: 'extra-in-projection',
    missingInB: 'missing-in-projection',
  },
  projectionVsRendered: {
    missingInA: 'extra-in-rendered',
    missingInB: 'missing-in-rendered',
  },
}

function classifyEntity(id: string): 'nodes' | 'edges' | 'layout' | 'selection' {
  if (id === '__viewport__') return 'layout'
  if (id === '__selection__') return 'selection'
  if (id.startsWith('edge:')) return 'edges'
  return 'nodes'
}

function normalizeField(id: string, field: string): string {
  if (id === '__viewport__') {
    return field === 'pan' ? 'pan-delta' : 'zoom-delta'
  }
  if (id === '__selection__') {
    return 'items.mismatch'
  }
  if (field === 'position') {
    return 'node-pos-delta'
  }
  if (field === 'visible') {
    return 'visibility.mismatch'
  }
  return `${field}.mismatch`
}

function classNamespace(id: string, field: string): 'nodes' | 'edges' | 'layout' | 'selection' {
  if (id === '__viewport__') return 'layout'
  if (id === '__selection__') return 'selection'
  if (field === 'position') return 'layout'
  return classifyEntity(id)
}

function collectScopeClassIds(scope: DriftScope, divergence: Divergence, ids: Set<string>): void {
  if (divergence.equal) {
    return
  }

  for (const missingId of divergence.missingInA) {
    ids.add(`${scope}.${classifyEntity(missingId)}.${MISSING_CLASS_SUFFIX[scope].missingInA}`)
  }

  for (const missingId of divergence.missingInB) {
    ids.add(`${scope}.${classifyEntity(missingId)}.${MISSING_CLASS_SUFFIX[scope].missingInB}`)
  }

  for (const diff of divergence.differing) {
    for (const field of diff.fields) {
      ids.add(`${scope}.${classNamespace(diff.id, field)}.${normalizeField(diff.id, field)}`)
    }
  }
}

export function classifyDriftReport(report: DriftReport): string[] {
  const ids = new Set<string>()

  collectScopeClassIds('dataVsProjection', report.dataVsProjection, ids)
  collectScopeClassIds('projectionVsRendered', report.projectionVsRendered, ids)

  if (report.nodeContentStale.some(entry => entry.fsLen < 0)) {
    ids.add('nodeContentStale.fs-missing')
  }
  if (report.nodeContentStale.some(entry => entry.fsLen >= 0 && entry.fsLen !== entry.mainLen)) {
    ids.add('nodeContentStale.length-mismatch')
  }

  return [...ids].sort((left, right) => left.localeCompare(right))
}

export function createDivergenceClassBaseline(classIds: readonly string[]): DivergenceClassBaseline {
  return {
    $schema: DIVERGENCE_CLASS_BASELINE_SCHEMA,
    description: 'Allowed divergence class ids for the W4-A drift soak harness baseline.',
    classIds: [...new Set(classIds)].sort((left, right) => left.localeCompare(right)),
  }
}
