import {graphStateApply} from '../../../src/node'

export async function runApplyCommand(args: readonly string[]): Promise<void> {
  await graphStateApply(args)
}
