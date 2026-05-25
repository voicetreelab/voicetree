import {graphRename} from '../../../src/node'

export async function runRenameCommand(args: string[]): Promise<void> {
  await graphRename(0, undefined, args)
}
