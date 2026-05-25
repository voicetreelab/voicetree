import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULT_OUT_DIR = '/tmp/vt-debug/stress'

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
export const SCRIPT_DIR = path.resolve(MODULE_DIR, '..')

export const DEFAULT_RESULT_OUT = path.resolve(SCRIPT_DIR, '../fixtures/w4a-result.json')
export const DEFAULT_DIVERGENCE_BASELINE = path.resolve(
  SCRIPT_DIR,
  '../fixtures/divergence-class-baseline.json',
)
export const DEFAULT_FLOW_BASELINE = path.resolve(SCRIPT_DIR, '../fixtures/int1-baseline.json')
export const VT_DEBUG_BIN = path.resolve(SCRIPT_DIR, './vt-debug.ts')
export const VT_DEBUG_FLOWS_BIN = path.resolve(SCRIPT_DIR, './vt-debug-flows.ts')
export const REPO_ROOT = path.resolve(SCRIPT_DIR, '../../../..')
