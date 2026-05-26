import {dumpState} from '../../../src/node'
import {parseStateDumpArgs} from '../../cliArgs'
import {fail} from '../shared'

export async function runStateCommand(args: readonly string[]): Promise<void> {
  const [subcommand, ...stateArgs] = args
  if (subcommand !== 'dump') {
    fail('Usage: vt-graph state dump <root> [--pretty|--no-pretty] [--out <file>]')
  }

  const parsed = parseStateDumpArgs(stateArgs)
  const result = await dumpState(parsed.rootPath, {
    pretty: parsed.pretty,
    outFile: parsed.outFile,
  })
  process.stdout.write(result.json)
}
