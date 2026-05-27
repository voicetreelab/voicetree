import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULT_OUT_DIR = '/tmp/vt-debug/flows'
export const OBSERVATION_FLAGS = ['--screenshot-each', '--console-each', '--state-each', '--stop-on-error=false']

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
export const SCRIPT_DIR = path.resolve(MODULE_DIR, '..')

export const DEFAULT_FIXTURE_OUT = path.resolve(SCRIPT_DIR, '../fixtures/int1-baseline.json')
export const VT_DEBUG_BIN = path.resolve(SCRIPT_DIR, './vt-debug.ts')
export const REPO_ROOT = path.resolve(SCRIPT_DIR, '../../../..')
