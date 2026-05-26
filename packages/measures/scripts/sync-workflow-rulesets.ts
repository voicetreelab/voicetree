// Sync GitHub branch required-check rulesets from the generated measures
// workflow source of truth. Defaults to dry-run JSON; pass --apply to mutate
// the repository rulesets through `gh api`.

import {spawn} from 'node:child_process'

import {
    discoverTiers,
    requiredStatusContextsByBaseRef,
    type RequiredContextsByBaseRef,
} from './gen-workflows.ts'

type RulesetTarget = {
    readonly baseRef: string
    readonly name: string
}

type PlannedRuleset = RulesetTarget & {
    readonly requiredStatusChecks: readonly string[]
}

type RulesetRule = {
    readonly type: string
    readonly parameters?: unknown
}

const DEFAULT_REPO = 'voicetreelab/voicetree'
const DEFAULT_TARGETS: readonly RulesetTarget[] = [
    {baseRef: 'dev', name: 'Require fast CI on dev'},
    {baseRef: 'main', name: 'Require CI green on main'},
]

export function planRulesets(
    requiredContextsByBaseRef: RequiredContextsByBaseRef,
    targets: readonly RulesetTarget[] = DEFAULT_TARGETS,
): readonly PlannedRuleset[] {
    return targets.map(target => ({
        ...target,
        requiredStatusChecks: requiredContextsByBaseRef[target.baseRef] ?? [],
    }))
}

async function main(): Promise<void> {
    const args = new Set(process.argv.slice(2))
    const apply = args.has('--apply')
    const repo = readArgValue('--repo=') ?? DEFAULT_REPO
    const requiredContexts = requiredStatusContextsByBaseRef(await discoverTiers())
    const plan = planRulesets(requiredContexts)
    if (!apply) {
        console.log(JSON.stringify({repo, mode: 'dry-run', rulesets: plan}, null, 2))
        return
    }
    for (const ruleset of plan) {
        await applyRuleset(repo, ruleset)
    }
}

function readArgValue(prefix: string): string | null {
    const arg = process.argv.slice(2).find(arg => arg.startsWith(prefix))
    return arg ? arg.slice(prefix.length) : null
}

async function applyRuleset(repo: string, plan: PlannedRuleset): Promise<void> {
    if (plan.requiredStatusChecks.length === 0) {
        throw new Error(`refusing to apply ${plan.name}: no required status checks for ${plan.baseRef}`)
    }
    const summaries = JSON.parse(await gh(repo, ['rulesets'])) as readonly {id: number; name: string}[]
    const summary = summaries.find(ruleset => ruleset.name === plan.name)
    if (!summary) throw new Error(`ruleset not found: ${plan.name}`)
    const current = JSON.parse(await gh(repo, [`rulesets/${summary.id}`])) as {
        readonly name: string
        readonly target: string
        readonly enforcement: string
        readonly conditions: unknown
        readonly rules: readonly {readonly type: string; readonly parameters?: unknown}[]
    }
    const body = {
        name: current.name,
        target: current.target,
        enforcement: current.enforcement,
        conditions: current.conditions,
        rules: rulesetRulesWithRequiredStatusChecks(current.rules, plan.requiredStatusChecks),
    }
    await gh(repo, [`rulesets/${summary.id}`], {method: 'PUT', input: JSON.stringify(body)})
    console.log(`updated ${plan.name}: ${plan.requiredStatusChecks.length} required checks`)
}

export function rulesetRulesWithRequiredStatusChecks(
    rules: readonly RulesetRule[],
    requiredStatusChecks: readonly string[],
): readonly RulesetRule[] {
    const replacement = requiredStatusChecksRule(requiredStatusChecks)
    let replaced = false
    const next = rules.map(rule => {
        if (rule.type !== 'required_status_checks') return rule
        replaced = true
        return replacement
    })
    return replaced ? next : [...next, replacement]
}

function requiredStatusChecksRule(requiredStatusChecks: readonly string[]): RulesetRule {
    return {
        type: 'required_status_checks',
        parameters: {
            do_not_enforce_on_create: false,
            strict_required_status_checks_policy: false,
            required_status_checks: requiredStatusChecks.map(context => ({context})),
        },
    }
}

async function gh(repo: string, pathParts: readonly string[], opts: {method?: string; input?: string} = {}): Promise<string> {
    const args = ['api']
    if (opts.method) args.push('--method', opts.method)
    if (opts.input !== undefined) args.push('--input', '-')
    args.push(`repos/${repo}/${pathParts.join('/')}`)
    return await spawnCollect('gh', args, opts.input)
}

function spawnCollect(command: string, args: readonly string[], input: string | undefined): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {stdio: ['pipe', 'pipe', 'pipe']})
        let stdout = ''
        let stderr = ''
        child.stdout.setEncoding('utf8')
        child.stderr.setEncoding('utf8')
        child.stdout.on('data', chunk => { stdout += chunk })
        child.stderr.on('data', chunk => { stderr += chunk })
        child.on('error', reject)
        child.on('close', code => {
            if (code === 0) resolve(stdout)
            else reject(new Error(`${command} ${args.join(' ')} failed with ${code}: ${stderr}`))
        })
        if (input !== undefined) child.stdin.end(input)
        else child.stdin.end()
    })
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(err => { console.error(err); process.exit(1) })
}
