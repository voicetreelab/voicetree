import path from 'node:path'

import { FLOW_IDS, type FlowId } from '../../src/debug/flow/flows/index'
import { err } from '../../src/debug/protocol/Response'
import type { Response } from '../../src/debug/protocol/Response'

import { DEFAULT_FIXTURE_OUT, DEFAULT_OUT_DIR } from './paths'
import type { ParsedArgs, RunnerOptions } from './types'

function usage(message?: string): Response<never> {
  return err(
    'flows',
    message ?? `usage: vt-debug-flows <list|run-all|run <${FLOW_IDS.join('|')}>> [--out <dir>] [--fixture-out <file>] [--write-baseline] [--port <n> | --cdpPort <n> | --pid <n> | --vault <path>]`,
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

function isFlowId(value: string): value is FlowId {
  return FLOW_IDS.includes(value as FlowId)
}

export function parseArgs(argv: string[]): ParsedArgs | Response<never> {
  const [command, maybeFlowId, ...rest] = argv

  if (!command) {
    return usage('missing command')
  }

  let outDir = DEFAULT_OUT_DIR
  let fixtureOut = DEFAULT_FIXTURE_OUT
  let writeBaseline = false
  let port: number | undefined
  let pid: number | undefined
  let vault: string | undefined

  const flagArgs = command === 'run' ? rest : ([maybeFlowId, ...rest].filter(Boolean) as string[])

  try {
    for (let index = 0; index < flagArgs.length; index += 1) {
      const arg = flagArgs[index]

      if (arg === '--out') {
        outDir = path.resolve(readFlagValue('--out', flagArgs[index + 1]))
        index += 1
        continue
      }
      if (arg.startsWith('--out=')) {
        outDir = path.resolve(readFlagValue('--out', arg.slice('--out='.length)))
        continue
      }
      if (arg === '--fixture-out') {
        fixtureOut = path.resolve(readFlagValue('--fixture-out', flagArgs[index + 1]))
        index += 1
        continue
      }
      if (arg.startsWith('--fixture-out=')) {
        fixtureOut = path.resolve(readFlagValue('--fixture-out', arg.slice('--fixture-out='.length)))
        continue
      }
      if (arg === '--write-baseline') {
        writeBaseline = true
        continue
      }
      if (arg === '--port' || arg === '--cdpPort') {
        port = parseNumber('--port', flagArgs[index + 1])
        index += 1
        continue
      }
      if (arg.startsWith('--port=') || arg.startsWith('--cdpPort=')) {
        port = parseNumber('--port', arg.slice(arg.indexOf('=') + 1))
        continue
      }
      if (arg === '--pid') {
        pid = parseNumber('--pid', flagArgs[index + 1])
        index += 1
        continue
      }
      if (arg.startsWith('--pid=')) {
        pid = parseNumber('--pid', arg.slice('--pid='.length))
        continue
      }
      if (arg === '--vault') {
        vault = readFlagValue('--vault', flagArgs[index + 1])
        index += 1
        continue
      }
      if (arg.startsWith('--vault=')) {
        vault = readFlagValue('--vault', arg.slice('--vault='.length))
        continue
      }
      if (arg.startsWith('--')) {
        return usage(`unknown argument: ${arg}`)
      }
    }
  } catch (error) {
    return usage(String(error))
  }

  const options: RunnerOptions = { outDir, fixtureOut, writeBaseline, port, pid, vault }

  if (command === 'list') {
    return { command, options }
  }
  if (command === 'run-all') {
    return { command, options }
  }
  if (command === 'run') {
    if (!maybeFlowId || !isFlowId(maybeFlowId)) {
      return usage(`run requires a flow id (${FLOW_IDS.join(', ')})`)
    }
    return { command, flowId: maybeFlowId, options }
  }

  return usage(`unknown command: ${command}`)
}
