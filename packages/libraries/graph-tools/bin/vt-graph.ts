#!/usr/bin/env npx tsx
import {usage} from './vt-graph/usage'
import {runApplyCommand} from './vt-graph/commands/apply'
import {runHygieneCommand} from './vt-graph/commands/hygiene'
import {runLintCommand} from './vt-graph/commands/lint'
import {runLiveCommand} from './vt-graph/commands/live'
import {runMvCommand} from './vt-graph/commands/mv'
import {runRenameCommand} from './vt-graph/commands/rename'
import {runStateCommand} from './vt-graph/commands/state'
import {runStructureCliCommand} from './vt-graph/commands/structure'

const [,, command, ...args] = process.argv

async function main(): Promise<void> {
  switch (command) {
    case 'lint':
      await runLintCommand(args)
      break
    case 'structure':
      await runStructureCliCommand(args)
      break
    case 'rename':
      await runRenameCommand(args)
      break
    case 'mv':
      await runMvCommand(args)
      break
    case 'apply':
      await runApplyCommand(args)
      break
    case 'state':
      await runStateCommand(args)
      break
    case 'live':
      await runLiveCommand(args)
      break
    case 'hygiene':
      await runHygieneCommand(args)
      break
    default:
      console.log(usage())
      process.exit(1)
  }
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
