import {graphMove} from '../../../src/node-runtime'

export async function runMvCommand(args: string[]): Promise<void> {
  await graphMove(0, undefined, args)
}
