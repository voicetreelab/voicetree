#!/usr/bin/env npx tsx
import { lintGraph, formatLintReportHuman, formatLintReportJson, getGraphStructure, graphRename } from '../src/index'

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
    const folderPath = args[0] || process.cwd()
    const result = getGraphStructure(folderPath)
    console.log(result.ascii)
    break
  }
  case 'rename': {
    graphRename(0, undefined, args)
    break
  }
  default:
    console.log('Usage: vt-graph <lint|structure|rename> [path] [--json]')
    process.exit(1)
}
