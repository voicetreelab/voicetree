#!/usr/bin/env npx tsx
import {
  dumpState,
  formatLintReportHuman,
  formatLintReportJson,
  graphStateApply,
  graphMove,
  graphRename,
  lintGraphWithFixes,
} from '../src/node'
import {
  runHygieneAudit,
  formatHygieneReportHuman,
  formatHygieneReportJson,
  type HygieneRuleId,
} from '../src/lint/hygiene'
import {parseStateDumpArgs} from './cliArgs'
import {runStructureCommand} from './structureCommand'
import {runLiveCommand} from './liveCommands'

const [,, command, ...args] = process.argv

function fail(message: string): never {
  throw new Error(message)
}

function usage(): string {
  return [
    'Usage: vt-graph <lint|hygiene|structure|apply|rename|mv|state|live> [args]',
    '       vt-graph hygiene <vault> [--rule <id>] [--json]',
    '       vt-graph structure [folder] [--budget N] [--no-auto|--ascii|--mermaid] [--collapse F]... [--select X]... [--vault <path>]',
    '         (default: tree-cover with daemon overlay if available; auto-collapses coherent subgraphs once visible entities exceed budget — default 30)',
    '       vt-graph apply <cmd-json> [--state-file <path>] [--pretty|--no-pretty] [--out <file>]',
    '       vt-graph state dump <root> [--pretty|--no-pretty] [--out <file>]',
    '       vt-graph live view [--collapse F]... [--select X]... [--mermaid] [--vault <path>]',
    '       vt-graph live state dump [--no-pretty] [--vault <path>]',
    '       vt-graph live apply \'<json-cmd>\' [--vault <path>]',
    '       vt-graph live add-node --file <path> [--label <string>] [--x <number>] [--y <number>] [--vault <path>]',
    '       vt-graph live rm-node --file <path> [--vault <path>]',
    '       vt-graph live add-edge --src-file <path> --tgt-file <path> [--label <string>] [--vault <path>]',
    '       vt-graph live rm-edge --src-file <path> --tgt-file <path> [--vault <path>]',
    '       vt-graph live mv-node --file <path> --x <number> --y <number> [--vault <path>]',
    '       vt-graph live focus <node> [--hops N] [--vault <path>]',
    '       vt-graph live neighbors <node> [--hops N] [--vault <path>]',
    '       vt-graph live path <a> <b> [--vault <path>]',
  ].join('\n')
}

function getRequiredValue(parsedArgs: string[], index: number, flag: string): string {
  const value: string | undefined = parsedArgs[index]
  if (!value || value.startsWith('--')) {
    fail(`${flag} requires a value`)
  }

  return value
}

async function main(): Promise<void> {
  switch (command) {
    case 'lint': {
      let folderPath: string | undefined
      let jsonFlag = false
      let fixFlag = false

      for (const arg of args) {
        if (arg === '--json') {
          jsonFlag = true
          continue
        }

        if (arg === '--fix') {
          fixFlag = true
          continue
        }

        if (arg.startsWith('--')) {
          fail(`Unknown argument: ${arg}`)
        }

        if (folderPath !== undefined) {
          fail(`Unexpected argument: ${arg}`)
        }

        folderPath = arg
      }

      const report = lintGraphWithFixes({
        folderPath: folderPath || process.cwd(),
        applyFixes: fixFlag,
        agentName: process.env.AGENT_NAME,
      })
      console.log(jsonFlag ? formatLintReportJson(report) : formatLintReportHuman(report))
      break
    }
    case 'structure': {
      await runStructureCommand(args)
      break
    }
    case 'rename': {
      await graphRename(undefined, args)
      break
    }
    case 'mv': {
      await graphMove(undefined, args)
      break
    }
    case 'apply': {
      await graphStateApply(args)
      break
    }
    case 'state': {
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
      break
    }
    case 'live': {
      await runLiveCommand(args)
      break
    }

    case 'hygiene': {
      let projectRoot: string | undefined
      let ruleFilter: HygieneRuleId | undefined
      let jsonFlag = false

      const VALID_RULES: HygieneRuleId[] = ['max_wikilinks_per_node', 'max_tree_width', 'canonical_hierarchy']

      for (let i = 0; i < args.length; i++) {
        const arg = args[i]

        if (arg === '--json') { jsonFlag = true; continue }

        if (arg === '--rule') {
          const val = getRequiredValue(args, i + 1, '--rule')
          if (!VALID_RULES.includes(val as HygieneRuleId)) {
            fail(`Unknown rule: ${val}. Valid rules: ${VALID_RULES.join(', ')}`)
          }
          ruleFilter = val as HygieneRuleId
          i += 1
          continue
        }

        if (arg.startsWith('--rule=')) {
          const val = arg.slice('--rule='.length)
          if (!VALID_RULES.includes(val as HygieneRuleId)) {
            fail(`Unknown rule: ${val}. Valid rules: ${VALID_RULES.join(', ')}`)
          }
          ruleFilter = val as HygieneRuleId
          continue
        }

        if (arg.startsWith('--')) { fail(`Unknown argument: ${arg}`) }

        if (projectRoot !== undefined) { fail(`Unexpected argument: ${arg}`) }
        projectRoot = arg
      }

      if (!projectRoot) {
        fail('Usage: vt-graph hygiene <project-root> [--rule <id>] [--json]')
      }

      const report = runHygieneAudit(projectRoot, {rule: ruleFilter})
      console.log(jsonFlag ? formatHygieneReportJson(report) : formatHygieneReportHuman(report))
      if (report.summary.totalErrors > 0) process.exit(1)
      break
    }

    default:
      console.log(usage())
      process.exit(1)
  }
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
