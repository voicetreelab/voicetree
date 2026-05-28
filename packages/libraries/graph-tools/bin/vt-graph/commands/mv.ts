import {graphMove} from '../../../src/node'

export async function runMvCommand(args: string[]): Promise<void> {
  await graphMove(0, undefined, args)
}
