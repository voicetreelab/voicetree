import path from 'node:path'

import { err } from '../../src/debug/protocol/Response'
import type { Response } from '../../src/debug/protocol/Response'
import {
  DEFAULT_STRESS_SEED,
  DEFAULT_STRESS_SEQUENCE_LENGTH,
} from '../../src/debug/stress/stressSpec'

import {
  DEFAULT_DIVERGENCE_BASELINE,
  DEFAULT_FLOW_BASELINE,
  DEFAULT_OUT_DIR,
  DEFAULT_RESULT_OUT,
} from './paths'
import type { RunnerOptions } from './types'

function usage(message?: string): Response<never> {
  return err(
    'stress',
    message ?? 'usage: vt-debug-stress [--out <dir>] [--result-out <file>] [--baseline <file>] [--flow-baseline <file>] [--sequences <n>] [--sequence-length <n>] [--seed <n>] [--write-baseline] [--skip-flows] [--port <n> | --cdpPort <n> | --pid <n> | --vault <path>]',
  )
}

function readFlagValue(flag: string, value: string | undefined): string {
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`)
  }
  return value
}

function parseNumber(flag: string, value: string | undefined): number {
  const parsed = Number.parseInt(readFlagValue(flag, value), 10)
  if (!Number.isFinite(parsed)) {
    throw new Error(`${flag} requires an integer`)
  }
  return parsed
}

export function parseArgs(argv: string[]): RunnerOptions | Response<never> {
  let outDir = DEFAULT_OUT_DIR
  let resultOut = DEFAULT_RESULT_OUT
  let divergenceBaselinePath = DEFAULT_DIVERGENCE_BASELINE
  let flowBaselinePath = DEFAULT_FLOW_BASELINE
  let sequenceCount = 200
  let sequenceLength = DEFAULT_STRESS_SEQUENCE_LENGTH
  let seed = DEFAULT_STRESS_SEED
  let writeBaseline = false
  let skipFlows = false
  let port: number | undefined
  let pid: number | undefined
  let vault: string | undefined

  try {
    for (let index = 0; index < argv.length; index += 1) {
      const arg = argv[index]

      if (arg === '--out') {
        outDir = path.resolve(readFlagValue('--out', argv[index + 1]))
        index += 1
        continue
      }
      if (arg.startsWith('--out=')) {
        outDir = path.resolve(readFlagValue('--out', arg.slice('--out='.length)))
        continue
      }
      if (arg === '--result-out') {
        resultOut = path.resolve(readFlagValue('--result-out', argv[index + 1]))
        index += 1
        continue
      }
      if (arg.startsWith('--result-out=')) {
        resultOut = path.resolve(readFlagValue('--result-out', arg.slice('--result-out='.length)))
        continue
      }
      if (arg === '--baseline') {
        divergenceBaselinePath = path.resolve(readFlagValue('--baseline', argv[index + 1]))
        index += 1
        continue
      }
      if (arg.startsWith('--baseline=')) {
        divergenceBaselinePath = path.resolve(readFlagValue('--baseline', arg.slice('--baseline='.length)))
        continue
      }
      if (arg === '--flow-baseline') {
        flowBaselinePath = path.resolve(readFlagValue('--flow-baseline', argv[index + 1]))
        index += 1
        continue
      }
      if (arg.startsWith('--flow-baseline=')) {
        flowBaselinePath = path.resolve(readFlagValue('--flow-baseline', arg.slice('--flow-baseline='.length)))
        continue
      }
      if (arg === '--sequences') {
        sequenceCount = parseNumber('--sequences', argv[index + 1])
        index += 1
        continue
      }
      if (arg.startsWith('--sequences=')) {
        sequenceCount = parseNumber('--sequences', arg.slice('--sequences='.length))
        continue
      }
      if (arg === '--sequence-length') {
        sequenceLength = parseNumber('--sequence-length', argv[index + 1])
        index += 1
        continue
      }
      if (arg.startsWith('--sequence-length=')) {
        sequenceLength = parseNumber('--sequence-length', arg.slice('--sequence-length='.length))
        continue
      }
      if (arg === '--seed') {
        seed = parseNumber('--seed', argv[index + 1])
        index += 1
        continue
      }
      if (arg.startsWith('--seed=')) {
        seed = parseNumber('--seed', arg.slice('--seed='.length))
        continue
      }
      if (arg === '--write-baseline') {
        writeBaseline = true
        continue
      }
      if (arg === '--skip-flows') {
        skipFlows = true
        continue
      }
      if (arg === '--port' || arg === '--cdpPort') {
        port = parseNumber('--port', argv[index + 1])
        index += 1
        continue
      }
      if (arg.startsWith('--port=') || arg.startsWith('--cdpPort=')) {
        port = parseNumber('--port', arg.slice(arg.indexOf('=') + 1))
        continue
      }
      if (arg === '--pid') {
        pid = parseNumber('--pid', argv[index + 1])
        index += 1
        continue
      }
      if (arg.startsWith('--pid=')) {
        pid = parseNumber('--pid', arg.slice('--pid='.length))
        continue
      }
      if (arg === '--vault') {
        vault = readFlagValue('--vault', argv[index + 1])
        index += 1
        continue
      }
      if (arg.startsWith('--vault=')) {
        vault = readFlagValue('--vault', arg.slice('--vault='.length))
        continue
      }

      return usage(`unknown argument: ${arg}`)
    }
  } catch (error) {
    return usage(String(error))
  }

  if (sequenceCount < 1) {
    return usage('--sequences must be >= 1')
  }
  if (sequenceLength < 1) {
    return usage('--sequence-length must be >= 1')
  }

  return {
    outDir,
    resultOut,
    divergenceBaselinePath,
    flowBaselinePath,
    sequenceCount,
    sequenceLength,
    seed,
    writeBaseline,
    skipFlows,
    port,
    pid,
    vault,
  }
}
