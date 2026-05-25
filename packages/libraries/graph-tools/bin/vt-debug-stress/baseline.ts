import {
  createDivergenceClassBaseline,
  type DivergenceClassBaseline,
} from '../../src/debug/stress/divergenceClass'

import { readJson, writeJson } from './io'

export async function loadBaseline(
  baselinePath: string,
  observedClassIds: readonly string[],
  writeBaseline: boolean,
): Promise<DivergenceClassBaseline> {
  if (writeBaseline) {
    const baseline = createDivergenceClassBaseline(observedClassIds)
    await writeJson(baselinePath, baseline)
    return baseline
  }

  return readJson<DivergenceClassBaseline>(baselinePath)
}
