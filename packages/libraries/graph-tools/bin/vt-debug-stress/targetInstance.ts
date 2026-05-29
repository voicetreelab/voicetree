import { type DebugInstance } from '../../src/debug/protocol/discover'
import { err } from '../../src/debug/protocol/Response'
import type { Response } from '../../src/debug/protocol/Response'
import { resolveDebugInstance } from '../../src/debug/protocol/portResolution'

import type { RunnerOptions } from './types'

export async function resolveTargetInstance(options: RunnerOptions): Promise<DebugInstance | Response<never>> {
  const pick = await resolveDebugInstance({
    port: options.port,
    pid: options.pid,
    project: options.project,
  })

  if (!pick.ok) {
    return err('stress', pick.message, pick.hint, 2)
  }

  return pick.instance
}
