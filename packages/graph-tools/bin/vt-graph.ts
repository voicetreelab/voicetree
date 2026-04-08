#!/usr/bin/env npx tsx
import { lintGraph, formatLintReportHuman, formatLintReportJson, getGraphStructure, graphMove, graphRename } from '../src/index'

const [,, command, ...args] = process.argv

switch (command) {
  case 'lint': {
    const folderPath = args[0] || process.cwd()
    const jsonFlag = args.includes('--json')
    const report = lintGraph(folderPath)
    console.log(jsonFlag ? formatLintReportJson(report) : formatLintReportHuman(report))
    break
  }
  case 'structure': {
    let folderPath: string | undefined
    let withSummaries: boolean | undefined

    for (const arg of args) {
      if (arg === '--with-summaries') {
        if (withSummaries === false) {
          console.error('Cannot combine --with-summaries and --no-summaries')
          process.exit(1)
        }
        withSummaries = true
        continue
      }

      if (arg === '--no-summaries') {
        if (withSummaries === true) {
          console.error('Cannot combine --with-summaries and --no-summaries')
          process.exit(1)
        }
        withSummaries = false
        continue
      }

      if (arg.startsWith('--')) {
        console.error(`Unknown argument: ${arg}`)
        process.exit(1)
      }

      if (folderPath !== undefined) {
        console.error(`Unexpected argument: ${arg}`)
        process.exit(1)
      }

      folderPath = arg
    }

    const resolvedFolderPath = folderPath || process.cwd()
    const result = getGraphStructure(resolvedFolderPath, {withSummaries})
    console.log(result.ascii)
    break
  }
  case 'rename': {
    graphRename(0, undefined, args)
    break
  }
  case 'mv': {
    graphMove(0, undefined, args)
    break
  }
  default:
    console.log('Usage: vt-graph <lint|structure|rename|mv> [path] [--json] [--with-summaries|--no-summaries]')
    process.exit(1)
}
