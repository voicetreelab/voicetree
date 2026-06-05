import {graphStateApply} from '../../../src/node-runtime'

export async function runApplyCommand(args: readonly string[]): Promise<void> {
  await graphStateApply(args)
}
