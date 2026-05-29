// Drift detector for the generated CI workflow.
//
// Two black-box assertions:
//   1) Pure transform sanity: the same TierSpecs input → the same YAML
//      output (deterministic, no mocking of internals).
//   2) Checked-in artifact: `.github/workflows/measures-budget-gate.generated.yml`
//      matches what `discoverTiers + tierSpecsToWorkflow + workflowYamlToText`
//      would emit right now from the real folder tree. Drift = "you edited
//      the generator (or a _workflow.ts) but didn't run `npm run gen:workflows`".

import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

import {describe, expect, it} from 'vitest'

import {
    discoverTiers,
    requiredStatusContextsByBaseRef,
    tierSpecsToWorkflow,
    workflowYamlToText,
} from '../../../scripts/gen-workflows.ts'
import {
    planRulesets,
    rulesetRulesWithRequiredStatusChecks,
} from '../../../scripts/sync-workflow-rulesets.ts'

const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(TEST_DIR, '..', '..', '..', '..', '..')
const CHECKS_DIR = join(REPO_ROOT, 'packages', 'measures', 'src', 'checks')
const GENERATED_YAML_PATH = join(REPO_ROOT, '.github', 'workflows', 'measures-budget-gate.generated.yml')

describe('workflow generator — pure transform on a synthesized fixture', () => {
    it('is deterministic: same fixture input → identical output across runs', async () => {
        const root = await mkdtemp(join(tmpdir(), 'workflow-gen-fixture-'))
        try {
            await writeTierFixture(root, 'tier_0_pre_commit', {needs: [], protection: {requiredOn: ['dev'], conditionalOn: []}}, {
                'lint/foo.ts': checkSrc('foo-check'),
            })
            await writeTierFixture(root, 'tier_1', {needs: [], protection: {requiredOn: ['dev'], conditionalOn: []}}, {
                'unit/bar.ts': checkSrc('bar-check'),
                'unit/baz.ts': checkSrc('baz-check'),
            })
            const a = workflowYamlToText(tierSpecsToWorkflow(await discoverTiers(root)))
            const b = workflowYamlToText(tierSpecsToWorkflow(await discoverTiers(root)))
            expect(a).toBe(b)
            // And ensure the output is non-trivial.
            expect(a).toContain('foo-check')
            expect(a).toContain('bar-check,baz-check')
            expect(a).toContain('budget-gate:')
        } finally {
            await rm(root, {recursive: true, force: true})
        }
    })

    it('emits per-check matrix jobs when concern declares parallelism: per-check', async () => {
        const root = await mkdtemp(join(tmpdir(), 'workflow-gen-fixture-'))
        try {
            await writeTierFixture(root, 'tier_2', {needs: ['tier_1']}, {})
            await writeTierFixture(root, 'tier_1', {needs: []}, {})
            await writeConcernFixture(root, 'tier_2', 'fuzz', {parallelism: 'per-check'}, {
                'a.ts': checkSrc('a-fuzz'),
                'b.ts': checkSrc('b-fuzz'),
            })
            const text = workflowYamlToText(tierSpecsToWorkflow(await discoverTiers(root)))
            expect(text).toContain('strategy:')
            expect(text).toContain('matrix:')
            expect(text).toContain('check_id:')
            expect(text).toContain('- a-fuzz')
            expect(text).toContain('- b-fuzz')
            expect(text).toContain('${{ matrix.check_id }}')
        } finally {
            await rm(root, {recursive: true, force: true})
        }
    })

    it('emits an every-PR pull_request trigger alongside workflow_dispatch', async () => {
        const root = await mkdtemp(join(tmpdir(), 'workflow-gen-fixture-'))
        try {
            await writeTierFixture(root, 'tier_0_pre_commit', {needs: []}, {
                'lint/foo.ts': checkSrc('foo-check'),
            })
            const text = workflowYamlToText(tierSpecsToWorkflow(await discoverTiers(root)))
            expect(text).toContain(
                "on:\n" +
                "  workflow_dispatch: {}\n" +
                "  pull_request:",
            )
            expect(text).not.toContain('paths:')
        } finally {
            await rm(root, {recursive: true, force: true})
        }
    })

    it('derives required ruleset contexts from tier-level protection metadata', async () => {
        const root = await mkdtemp(join(tmpdir(), 'workflow-gen-fixture-'))
        try {
            await writeTierFixture(root, 'tier_0_pre_commit', {needs: [], protection: {requiredOn: ['dev', 'main'], conditionalOn: []}}, {
                'lint/foo.ts': checkSrc('foo-check'),
            })
            await writeTierFixture(root, 'tier_1', {needs: [], protection: {requiredOn: ['dev', 'main'], conditionalOn: []}}, {
                'unit/bar.ts': checkSrc('bar-check'),
            })
            await writeTierFixture(root, 'tier_2', {needs: ['tier_1'], protection: {requiredOn: ['dev', 'main'], conditionalOn: []}}, {})
            await writeConcernFixture(root, 'tier_2', 'fuzz', {parallelism: 'per-check'}, {
                'a.ts': checkSrc('a-fuzz'),
                'b.ts': checkSrc('b-fuzz'),
            })
            await writeTierFixture(root, 'tier_3', {needs: ['tier_2'], protection: {requiredOn: ['main'], conditionalOn: []}}, {
                'e2e/heavy.ts': checkSrc('heavy-e2e'),
            })
            await writeTierFixture(root, 'tier_4', {needs: ['tier_3'], protection: {requiredOn: [], conditionalOn: ['main']}}, {
                'analyzers/deep.ts': checkSrc('deep-analyzer'),
            })

            const contexts = requiredStatusContextsByBaseRef(await discoverTiers(root))

            expect(contexts.dev).toEqual([
                'budget-gate',
                'tier-0-pre-commit-lint',
                'tier-1-unit',
                'tier-2-fuzz (a-fuzz)',
                'tier-2-fuzz (b-fuzz)',
            ])
            expect(contexts.main).toContain('tier-3-e2e')
            expect(contexts.main).toContain('budget-gate-main')
            expect(contexts.main).not.toContain('tier-4-analyzers')
        } finally {
            await rm(root, {recursive: true, force: true})
        }
    })

    it('limits each budget gate needs graph to that base ref required jobs', async () => {
        const root = await mkdtemp(join(tmpdir(), 'workflow-gen-fixture-'))
        try {
            await writeTierFixture(root, 'tier_1', {needs: [], protection: {requiredOn: ['dev', 'main'], conditionalOn: []}}, {
                'unit/fast.ts': checkSrc('fast-unit'),
            })
            await writeTierFixture(root, 'tier_2', {needs: ['tier_1'], protection: {requiredOn: ['dev', 'main'], conditionalOn: []}}, {
                'contract/public-api.ts': checkSrc('public-api-contract'),
            })
            await writeTierFixture(root, 'tier_3', {needs: ['tier_2'], protection: {requiredOn: ['main'], conditionalOn: []}}, {
                'e2e/heavy.ts': checkSrc('heavy-e2e'),
            })

            const text = workflowYamlToText(tierSpecsToWorkflow(await discoverTiers(root)))

            expect(text).toContain(
                '  budget-gate:\n' +
                '    name: budget-gate\n' +
                '    needs: [tier-1-unit, tier-2-contract]\n' +
                '    if: "always() && github.base_ref == \'dev\'"',
            )
            expect(text).toContain(
                '  budget-gate-main:\n' +
                '    name: budget-gate-main\n' +
                '    needs: [tier-1-unit, tier-2-contract, tier-3-e2e]\n' +
                '    if: "always() && github.base_ref == \'main\'"',
            )
        } finally {
            await rm(root, {recursive: true, force: true})
        }
    })

    it('emits sequential capture-ci commands when a concern requires shared-resource isolation', async () => {
        const root = await mkdtemp(join(tmpdir(), 'workflow-gen-fixture-'))
        try {
            await writeTierFixture(root, 'tier_2', {needs: []}, {})
            await writeConcernFixture(root, 'tier_2', 'contract', {sequential: true}, {
                'public-api.ts': checkSrc('public-api-contract'),
            })
            const text = workflowYamlToText(tierSpecsToWorkflow(await discoverTiers(root)))
            expect(text).toContain('tier-2-contract:')
            expect(text).toContain('--tier-max=2 \\\n            --sequential \\\n            --only=public-api-contract')
        } finally {
            await rm(root, {recursive: true, force: true})
        }
    })

    it('wires precheck job outputs to a concrete step id', async () => {
        const root = await mkdtemp(join(tmpdir(), 'workflow-gen-fixture-'))
        try {
            await writeTierFixture(root, 'tier_3', {needs: [], protection: {requiredOn: ['main'], conditionalOn: []}}, {
                'e2e/heavy.ts': checkSrc('heavy-e2e'),
            })
            await writeTierFixture(root, 'tier_4', {
                needs: ['tier_3'],
                trigger: {baseRef: 'main'},
                precheck: 'tier4-precheck',
                protection: {requiredOn: [], conditionalOn: ['main']},
            }, {
                'analyzers/deep.ts': checkSrc('deep-analyzer'),
            })

            const text = workflowYamlToText(tierSpecsToWorkflow(await discoverTiers(root)))

            expect(text).toContain('outputs:\n      reason: "${{ steps.decide.outputs.reason }}"\n      should_run: "${{ steps.decide.outputs.should_run }}"')
            expect(text).toContain('- name: decide\n        id: decide')
            expect(text).toContain("if: \"github.base_ref == 'main' && needs.tier4-precheck.outputs.should_run == 'true'\"")
        } finally {
            await rm(root, {recursive: true, force: true})
        }
    })
})

describe('workflow generator — checked-in YAML matches current folder tree', () => {
    it('.github/workflows/measures-budget-gate.generated.yml is up to date', async () => {
        const expected = workflowYamlToText(tierSpecsToWorkflow(await discoverTiers(CHECKS_DIR)))
        const actual = await readFile(GENERATED_YAML_PATH, 'utf8')
        if (actual !== expected) {
            // Surface the diff up to the user via Vitest's normal mismatch
            // diff. The error message also points at the fix command.
            const errorMsg = (
                'measures-budget-gate.generated.yml is out of sync with the folder tree.\n' +
                'Run `pnpm --filter @vt/measures run gen:workflows` to regenerate.'
            )
            expect(actual, errorMsg).toBe(expected)
        }
    })
})

describe('workflow ruleset sync — pure projection', () => {
    it('projects generated required contexts into dev/main ruleset plans only', () => {
        const plan = planRulesets({
            dev: ['budget-gate', 'tier-1-unit'],
            main: ['budget-gate-main', 'tier-1-unit', 'tier-3-e2e'],
            scratch: ['tier-9-experiment'],
        })

        expect(plan).toEqual([
            {baseRef: 'dev', name: 'Require fast CI on dev', requiredStatusChecks: ['budget-gate', 'tier-1-unit']},
            {baseRef: 'main', name: 'Require CI green on main', requiredStatusChecks: ['budget-gate-main', 'tier-1-unit', 'tier-3-e2e']},
        ])
    })

    it('replaces or appends the GitHub required-status-checks rule', () => {
        const required = ['budget-gate', 'tier-1-unit']

        expect(rulesetRulesWithRequiredStatusChecks([
            {type: 'pull_request'},
            {type: 'required_status_checks', parameters: {required_status_checks: [{context: 'stage1-checks'}]}},
        ], required)).toEqual([
            {type: 'pull_request'},
            {type: 'required_status_checks', parameters: {
                do_not_enforce_on_create: false,
                strict_required_status_checks_policy: false,
                required_status_checks: [{context: 'budget-gate'}, {context: 'tier-1-unit'}],
            }},
        ])

        expect(rulesetRulesWithRequiredStatusChecks([{type: 'pull_request'}], required)).toEqual([
            {type: 'pull_request'},
            {type: 'required_status_checks', parameters: {
                do_not_enforce_on_create: false,
                strict_required_status_checks_policy: false,
                required_status_checks: [{context: 'budget-gate'}, {context: 'tier-1-unit'}],
            }},
        ])
    })
})

// ── fixture helpers ──────────────────────────────────────────────────────────

type SpecLike = {
    needs?: readonly string[]
    parallelism?: 'per-concern' | 'per-check'
    setup?: {playwright?: boolean; xvfb?: boolean; node?: string}
    trigger?: {baseRef?: string | null}
    precheck?: string | null
    sequential?: boolean
    protection?: {requiredOn: readonly string[]; conditionalOn: readonly string[]}
}

function specSource(spec: SpecLike): string {
    const full = {
        needs: spec.needs ?? [],
        runner: 'ubuntu-latest',
        setup: {
            playwright: spec.setup?.playwright ?? false,
            xvfb: spec.setup?.xvfb ?? false,
            node: spec.setup?.node ?? '22',
        },
        trigger: {baseRef: spec.trigger?.baseRef ?? null},
        ...(spec.protection ? {protection: spec.protection} : {}),
        precheck: spec.precheck ?? null,
        parallelism: spec.parallelism ?? 'per-concern',
        sequential: spec.sequential ?? false,
    }
    return `export const workflow = ${JSON.stringify(full, null, 4)} as const\n`
}

function checkSrc(id: string): string {
    return `export const check = {\n` +
        `    id: '${id}',\n` +
        `    name: '${id}',\n` +
        `    category: 'Unit',\n` +
        `    display: '${id}',\n` +
        `    args: () => ['echo', '${id}'],\n` +
        `    parser: 'none',\n` +
        `} as const\n`
}

async function writeTierFixture(
    root: string,
    tier: string,
    spec: SpecLike,
    files: Record<string, string>,
): Promise<void> {
    const tierDir = join(root, tier)
    await mkdir(tierDir, {recursive: true})
    await writeFile(join(tierDir, '_workflow.ts'), specSource(spec), 'utf8')
    for (const [relPath, body] of Object.entries(files)) {
        const target = join(tierDir, relPath)
        await mkdir(dirname(target), {recursive: true})
        await writeFile(target, body, 'utf8')
    }
}

async function writeConcernFixture(
    root: string,
    tier: string,
    concern: string,
    spec: SpecLike,
    files: Record<string, string>,
): Promise<void> {
    const concernDir = join(root, tier, concern)
    await mkdir(concernDir, {recursive: true})
    await writeFile(join(concernDir, '_workflow.ts'), specSource(spec), 'utf8')
    for (const [relPath, body] of Object.entries(files)) {
        const target = join(concernDir, relPath)
        await mkdir(dirname(target), {recursive: true})
        await writeFile(target, body, 'utf8')
    }
}
