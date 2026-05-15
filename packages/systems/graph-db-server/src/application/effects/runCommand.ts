import { initGraphModel } from '@vt/graph-model'
import { getProjectRootWatchedDirectory } from '@vt/graph-db-server/state/watch-folder-store'
import { VaultStateSchema } from '@vt/graph-db-server/contract'
import {
  addReadPath,
  getReadPaths,
  getWritePath,
  removeReadPath,
  setWritePath,
} from '@vt/graph-db-server/state/vaultAllowlist'
import type { Command, CommandOutput } from '../domain/command.ts'
import type { SessionRegistry } from '../session/registry.ts'
import { projectAndBroadcast } from '../session/projectAndBroadcast.ts'

type RunCommandDeps = {
  registry?: SessionRegistry
}

function requireRegistry(deps: RunCommandDeps): SessionRegistry {
  if (!deps.registry) {
    throw new Error('Command requires a session registry')
  }
  return deps.registry
}

async function readVaultState(): Promise<CommandOutput['ReadVaultState']> {
  const vaultPath = getProjectRootWatchedDirectory()
  if (!vaultPath) {
    throw new Error('Mounted vault root is not initialized')
  }

  const readPaths = [...(await getReadPaths())]
  const writePathOption = await getWritePath() as { readonly value?: unknown }
  const writePath = typeof writePathOption.value === 'string'
    ? writePathOption.value
    : vaultPath

  return VaultStateSchema.parse({ vaultPath, readPaths, writePath })
}

export async function runCommand<C extends Command>(
  command: C,
  deps: RunCommandDeps = {},
): Promise<CommandOutput[C['type']]> {
  switch (command.type) {
    case 'AddVaultReadPath':
      return await addReadPath(command.path) as CommandOutput[C['type']]
    case 'InitializeGraphModel':
      initGraphModel({ appSupportPath: command.appSupportPath })
      return undefined as CommandOutput[C['type']]
    case 'ProjectAndBroadcast':
      await projectAndBroadcast(command.session)
      return undefined as CommandOutput[C['type']]
    case 'ReadVaultState':
      return await readVaultState() as CommandOutput[C['type']]
    case 'RegistryTouch':
      requireRegistry(deps).touch(command.sessionId)
      return undefined as CommandOutput[C['type']]
    case 'RemoveVaultReadPath':
      return await removeReadPath(command.path) as CommandOutput[C['type']]
    case 'SetVaultWritePath':
      return await setWritePath(command.path) as CommandOutput[C['type']]
    default: {
      const _exhaustive: never = command
      return _exhaustive
    }
  }
}
