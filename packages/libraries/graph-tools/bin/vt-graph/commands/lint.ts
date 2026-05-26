import {
  formatLintReportHuman,
  formatLintReportJson,
  lintGraphWithFixes,
} from '../../../src/node'
import {fail} from '../shared'

export async function runLintCommand(args: readonly string[]): Promise<void> {
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
}
