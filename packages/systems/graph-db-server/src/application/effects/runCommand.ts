import type { Command } from '../domain/command.ts'
import type { SessionRegistry } from '../session/registry.ts'
import { projectAndBroadcast } from '../session/projectAndBroadcast.ts'

export async function runCommand(
  command: Command,
  deps: { registry: SessionRegistry },
): Promise<void> {
  switch (command.type) {
    case 'RegistryTouch':
      deps.registry.touch(command.sessionId)
      return
    case 'ProjectAndBroadcast':
      await projectAndBroadcast(command.session)
      return
    default: {
      const _exhaustive: never = command
      return _exhaustive
    }
  }
}
