import {runStructureCommand} from '../../structureCommand'

export async function runStructureCliCommand(args: string[]): Promise<void> {
  await runStructureCommand(args)
}
