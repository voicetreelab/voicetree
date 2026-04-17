#!/usr/bin/env npx tsx
import {
  dumpState,
  formatLintReportHuman,
  formatLintReportJson,
  graphStateApply,
  getGraphStructure,
  graphMove,
  graphRename,
  lintGraphWithFixes,
  renderGraphView,
  liveStateDump,
  liveApply,
  liveView,
  liveFocus,
  liveNeighbors,
  livePath,
  type ViewFormat,
} from '../src/node'
import {
  runHygieneAudit,
  formatHygieneReportHuman,
  formatHygieneReportJson,
  type HygieneRuleId,
} from '../src/hygiene'

const [,, command, ...args] = process.argv

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

function usage(): string {
  return [
    'Usage: vt-graph <lint|hygiene|structure|view|apply|rename|mv|state|live> [args]',
    '       vt-graph hygiene <vault> [--rule <id>] [--json]',
    '       vt-graph apply <cmd-json> [--state-file <path>] [--pretty|--no-pretty] [--out <file>]',
    '       vt-graph state dump <root> [--pretty|--no-pretty] [--out <file>]',
    '       vt-graph live view [--collapse F]... [--select X]... [--mermaid] [--port N]',
    '       vt-graph live state dump [--no-pretty] [--port N]',
    '       vt-graph live apply \'<json-cmd>\' [--port N]',
    '       vt-graph live focus <node> [--hops N] [--port N]',
    '       vt-graph live neighbors <node> [--hops N] [--port N]',
    '       vt-graph live path <a> <b> [--port N]',
  ].join('\n')
}

function getRequiredValue(parsedArgs: string[], index: number, flag: string): string {
  const value: string | undefined = parsedArgs[index]
  if (!value || value.startsWith('--')) {
    fail(`${flag} requires a value`)
  }

  return value
}

function parsePrettyValue(value: string): boolean {
  if (value === 'true') {
    return true
  }

  if (value === 'false') {
    return false
  }

  fail(`Invalid value for --pretty: ${value}. Use true or false.`)
}

function parseStateDumpArgs(parsedArgs: string[]): {rootPath: string; pretty: boolean; outFile?: string} {
  let rootPath: string | undefined
  let pretty = true
  let outFile: string | undefined

  for (let i = 0; i < parsedArgs.length; i++) {
    const arg = parsedArgs[i]

    if (arg === '--pretty') {
      pretty = true
      continue
    }

    if (arg === '--no-pretty') {
      pretty = false
      continue
    }

    if (arg.startsWith('--pretty=')) {
      pretty = parsePrettyValue(arg.slice('--pretty='.length))
      continue
    }

    if (arg === '--out') {
      outFile = getRequiredValue(parsedArgs, i + 1, '--out')
      i += 1
      continue
    }

    if (arg.startsWith('--out=')) {
      outFile = arg.slice('--out='.length)
      if (!outFile) {
        fail('--out requires a value')
      }
      continue
    }

    if (arg.startsWith('--')) {
      fail(`Unknown argument: ${arg}`)
    }

    if (rootPath !== undefined) {
      fail(`Unexpected argument: ${arg}`)
    }

    rootPath = arg
  }

  if (rootPath === undefined) {
    fail('Usage: vt-graph state dump <root> [--pretty|--no-pretty] [--out <file>]')
  }

  return {
    rootPath,
    pretty,
    ...(outFile ? {outFile} : {}),
  }
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
      let folderPath: string | undefined
      let withSummaries: boolean | undefined

      for (const arg of args) {
        if (arg === '--with-summaries') {
          if (withSummaries === false) {
            fail('Cannot combine --with-summaries and --no-summaries')
          }
          withSummaries = true
          continue
        }

        if (arg === '--no-summaries') {
          if (withSummaries === true) {
            fail('Cannot combine --with-summaries and --no-summaries')
          }
          withSummaries = false
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

      const resolvedFolderPath = folderPath || process.cwd()
      const result = getGraphStructure(resolvedFolderPath, {withSummaries})
      console.log(result.ascii)
      break
    }
    case 'rename': {
      await graphRename(0, undefined, args)
      break
    }
    case 'mv': {
      await graphMove(0, undefined, args)
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
    case 'view': {
      let folderPath: string | undefined
      let format: ViewFormat = 'ascii'
      let showCrossEdges: boolean = true
      const collapsedFolders: string[] = []
      const selectedIds: string[] = []

      for (let i = 0; i < args.length; i++) {
        const arg = args[i]
        if (arg === '--mermaid') { format = 'mermaid'; continue }
        if (arg === '--ascii') { format = 'ascii'; continue }
        if (arg.startsWith('--format=')) {
          const value: string = arg.slice('--format='.length)
          if (value !== 'ascii' && value !== 'mermaid') {
            fail(`Unknown format: ${value}`)
          }
          format = value
          continue
        }
        if (arg === '--no-cross-edges') { showCrossEdges = false; continue }
        if (arg === '--collapse') {
          const next: string | undefined = args[++i]
          if (!next || next.startsWith('--')) {
            fail('--collapse requires a folder argument')
          }
          collapsedFolders.push(next)
          continue
        }
        if (arg.startsWith('--collapse=')) {
          collapsedFolders.push(arg.slice('--collapse='.length))
          continue
        }
        if (arg === '--select') {
          const next: string | undefined = args[++i]
          if (!next || next.startsWith('--')) {
            fail('--select requires a node id argument')
          }
          selectedIds.push(next)
          continue
        }
        if (arg.startsWith('--select=')) {
          selectedIds.push(arg.slice('--select='.length))
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

      const result = renderGraphView(folderPath || process.cwd(), {format, showCrossEdges, collapsedFolders, selectedIds})
      console.log(result.output)
      if (format === 'ascii') {
        console.log(`\n${result.nodeCount} nodes — ${result.folderNodeCount} folder nodes, ${result.virtualFolderCount} virtual folders, ${result.fileNodeCount} files`)
      }
      break
    }
    case 'live': {
      const [liveSubcommand, ...liveArgs] = args

      if (liveSubcommand === 'view') {
        let format: ViewFormat = 'ascii'
        const collapsedFolders: string[] = []
        const selectedIds: string[] = []
        let port: number | undefined

        for (let i = 0; i < liveArgs.length; i++) {
          const arg = liveArgs[i]
          if (arg === '--mermaid') { format = 'mermaid'; continue }
          if (arg === '--ascii') { format = 'ascii'; continue }
          if (arg === '--collapse') {
            const next = liveArgs[++i]
            if (!next || next.startsWith('--')) fail('--collapse requires a value')
            collapsedFolders.push(next)
            continue
          }
          if (arg.startsWith('--collapse=')) {
            collapsedFolders.push(arg.slice('--collapse='.length))
            continue
          }
          if (arg === '--select') {
            const next = liveArgs[++i]
            if (!next || next.startsWith('--')) fail('--select requires a value')
            selectedIds.push(next)
            continue
          }
          if (arg.startsWith('--select=')) {
            selectedIds.push(arg.slice('--select='.length))
            continue
          }
          if (arg === '--port') {
            const next = liveArgs[++i]
            if (!next || next.startsWith('--')) fail('--port requires a value')
            port = parseInt(next, 10)
            continue
          }
          if (arg.startsWith('--port=')) {
            port = parseInt(arg.slice('--port='.length), 10)
            continue
          }
          if (arg.startsWith('--')) fail(`Unknown argument: ${arg}`)
        }

        const result = await liveView({format, collapsedFolders, selectedIds, port})
        console.log(result.output)
        if (format === 'ascii') {
          console.log(`\n${result.nodeCount} nodes — ${result.folderNodeCount} folder nodes, ${result.virtualFolderCount} virtual folders, ${result.fileNodeCount} files`)
        }
        break
      }

      if (liveSubcommand === 'state') {
        const [stateSubcmd, ...stateArgs] = liveArgs
        if (stateSubcmd !== 'dump') {
          fail('Usage: vt-graph live state dump [--no-pretty] [--port N]')
        }
        let pretty = true
        let port: number | undefined
        for (let i = 0; i < stateArgs.length; i++) {
          const arg = stateArgs[i]
          if (arg === '--pretty') { pretty = true; continue }
          if (arg === '--no-pretty') { pretty = false; continue }
          if (arg === '--port') {
            const next = stateArgs[++i]
            if (!next || next.startsWith('--')) fail('--port requires a value')
            port = parseInt(next, 10)
            continue
          }
          if (arg.startsWith('--port=')) {
            port = parseInt(arg.slice('--port='.length), 10)
            continue
          }
          if (arg.startsWith('--')) fail(`Unknown argument: ${arg}`)
        }
        const result = await liveStateDump({pretty, port})
        process.stdout.write(result.json)
        break
      }

      if (liveSubcommand === 'apply') {
        let cmdJson: string | undefined
        let port: number | undefined
        for (let i = 0; i < liveArgs.length; i++) {
          const arg = liveArgs[i]
          if (arg === '--port') {
            const next = liveArgs[++i]
            if (!next || next.startsWith('--')) fail('--port requires a value')
            port = parseInt(next, 10)
            continue
          }
          if (arg.startsWith('--port=')) {
            port = parseInt(arg.slice('--port='.length), 10)
            continue
          }
          if (arg.startsWith('--')) fail(`Unknown argument: ${arg}`)
          if (cmdJson !== undefined) fail(`Unexpected argument: ${arg}`)
          cmdJson = arg
        }
        if (!cmdJson) fail("Usage: vt-graph live apply '<json-cmd>' [--port N]")
        const result = await liveApply(cmdJson, {port})
        process.stdout.write(result.output)
        break
      }

      if (liveSubcommand === 'focus') {
        const nodeId = liveArgs[0]
        if (!nodeId || nodeId.startsWith('--')) fail('Usage: vt-graph live focus <node> [--hops N] [--port N]')
        let hops = 1
        let port: number | undefined
        for (let i = 1; i < liveArgs.length; i++) {
          const arg = liveArgs[i]
          if (arg === '--hops') {
            const next = liveArgs[++i]
            if (!next || next.startsWith('--')) fail('--hops requires a value')
            hops = parseInt(next, 10)
            continue
          }
          if (arg.startsWith('--hops=')) { hops = parseInt(arg.slice('--hops='.length), 10); continue }
          if (arg === '--port') {
            const next = liveArgs[++i]
            if (!next || next.startsWith('--')) fail('--port requires a value')
            port = parseInt(next, 10)
            continue
          }
          if (arg.startsWith('--port=')) { port = parseInt(arg.slice('--port='.length), 10); continue }
          if (arg.startsWith('--')) fail(`Unknown argument: ${arg}`)
        }
        console.log(await liveFocus(nodeId, {hops, port}))
        break
      }

      if (liveSubcommand === 'neighbors') {
        const nodeId = liveArgs[0]
        if (!nodeId || nodeId.startsWith('--')) fail('Usage: vt-graph live neighbors <node> [--hops N] [--port N]')
        let hops = 1
        let port: number | undefined
        for (let i = 1; i < liveArgs.length; i++) {
          const arg = liveArgs[i]
          if (arg === '--hops') {
            const next = liveArgs[++i]
            if (!next || next.startsWith('--')) fail('--hops requires a value')
            hops = parseInt(next, 10)
            continue
          }
          if (arg.startsWith('--hops=')) { hops = parseInt(arg.slice('--hops='.length), 10); continue }
          if (arg === '--port') {
            const next = liveArgs[++i]
            if (!next || next.startsWith('--')) fail('--port requires a value')
            port = parseInt(next, 10)
            continue
          }
          if (arg.startsWith('--port=')) { port = parseInt(arg.slice('--port='.length), 10); continue }
          if (arg.startsWith('--')) fail(`Unknown argument: ${arg}`)
        }
        console.log(await liveNeighbors(nodeId, {hops, port}))
        break
      }

      if (liveSubcommand === 'path') {
        const nodeA = liveArgs[0]
        const nodeB = liveArgs[1]
        if (!nodeA || nodeA.startsWith('--') || !nodeB || nodeB.startsWith('--')) {
          fail('Usage: vt-graph live path <a> <b> [--port N]')
        }
        let port: number | undefined
        for (let i = 2; i < liveArgs.length; i++) {
          const arg = liveArgs[i]
          if (arg === '--port') {
            const next = liveArgs[++i]
            if (!next || next.startsWith('--')) fail('--port requires a value')
            port = parseInt(next, 10)
            continue
          }
          if (arg.startsWith('--port=')) { port = parseInt(arg.slice('--port='.length), 10); continue }
          if (arg.startsWith('--')) fail(`Unknown argument: ${arg}`)
        }
        console.log(await livePath(nodeA, nodeB, {port}))
        break
      }

      fail(`Unknown live subcommand: "${liveSubcommand ?? ''}"\n${usage()}`)
      break
    }

    case 'hygiene': {
      let vaultPath: string | undefined
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

        if (vaultPath !== undefined) { fail(`Unexpected argument: ${arg}`) }
        vaultPath = arg
      }

      if (!vaultPath) {
        fail('Usage: vt-graph hygiene <vault-path> [--rule <id>] [--json]')
      }

      const report = runHygieneAudit(vaultPath, {rule: ruleFilter})
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
