import {
  formatHygieneReportHuman,
  formatHygieneReportJson,
  runHygieneAudit,
  type HygieneRuleId,
} from '../../../src/lint/hygiene'
import {fail, getRequiredValue} from '../shared'

const VALID_RULES: HygieneRuleId[] = ['max_wikilinks_per_node', 'max_tree_width', 'canonical_hierarchy']

export async function runHygieneCommand(args: readonly string[]): Promise<void> {
  let projectRoot: string | undefined
  let ruleFilter: HygieneRuleId | undefined
  let jsonFlag = false

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
}
