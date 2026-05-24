#!/usr/bin/env node
/**
 * Throw-away sanity check that runs each behavioral measure against a few
 * real communities in the repo. Not part of the gate; just lets the agent
 * (and a reviewer) eyeball whether the numbers look plausible.
 *
 * Invoke from repo root:
 *   node --no-warnings=ExperimentalWarning --experimental-strip-types \
 *     packages/measures/scratch/behavioral-sanity-check.ts
 */
import {readdir} from 'node:fs/promises'
import {join, resolve} from 'node:path'
import {DEFAULT_REPO_ROOT} from '../src/_shared/discovery/discover-packages.ts'
import {parseSubgraph} from '../src/_shared/graph/parse-subgraph.ts'
// Importing the measures triggers their registry side-effects, but we use
// the returned `measure` value directly for clarity.
import {measure as moduleStateBindings} from '../src/checks/tier_0_subgraph/behavioral/module-state-bindings.ts'
import {measure as implicitGlobals} from '../src/checks/tier_0_subgraph/behavioral/implicit-globals.ts'
import {measure as astPurityRatio} from '../src/checks/tier_0_subgraph/behavioral/ast-purity-ratio.ts'

const REPO_ROOT = DEFAULT_REPO_ROOT

// Communities to probe, with the eyeball expectation we'd want to confirm.
const COMMUNITIES: ReadonlyArray<{
    readonly dir: string
    readonly community: string
    readonly expectation: 'clean' | 'middling' | 'red'
}> = [
    // (a) Expected CLEAN: pure types/constants library, no I/O surface.
    {dir: 'packages/libraries/graph-model/src', community: 'graph-model', expectation: 'clean'},
    // (c) Expected MIDDLING: graph-db-server/state — empirical anchor from
    //     behavioral-complexity.test (9 module-level mutables, but only a
    //     small impure surface beyond that).
    {dir: 'packages/systems/graph-db-server/src/state', community: 'graph-db-server/state', expectation: 'middling'},
    // (b) Expected RED: webapp shell edge layer — fs/process/electron-IO
    //     concentrated here by design (the impure boundary the FCIS split exists for).
    {dir: 'webapp/src/shell/edge', community: 'webapp/shell', expectation: 'red'},
]

async function listTs(dir: string): Promise<string[]> {
    const out: string[] = []
    async function walk(d: string): Promise<void> {
        let entries
        try { entries = await readdir(d, {withFileTypes: true}) } catch { return }
        for (const e of entries) {
            const p = join(d, e.name)
            if (e.isDirectory()) await walk(p)
            else if (
                e.isFile() && (p.endsWith('.ts') || p.endsWith('.tsx'))
                && !p.endsWith('.test.ts') && !p.endsWith('.spec.ts')
                && !p.endsWith('.d.ts') && !p.endsWith('.config.ts')
            ) out.push(p)
        }
    }
    await walk(dir)
    return out.sort()
}

async function probe(label: string, expectation: string, dir: string): Promise<void> {
    const absDir = resolve(REPO_ROOT, dir)
    const files = await listTs(absDir)
    if (files.length === 0) {
        console.log(`\n[${label}] (${expectation})  ${dir}: no files found, skipping`)
        return
    }
    console.log(`\n[${label}] (expectation: ${expectation})  ${dir}  (${files.length} files)`)
    const subgraph = await parseSubgraph(files, {depth: 1, hops: 0, includeInbound: false})

    const msb = await moduleStateBindings.run({changedFiles: files, parsedSubgraph: subgraph})
    const ig = await implicitGlobals.run({changedFiles: files, parsedSubgraph: subgraph})
    const apr = await astPurityRatio.run({changedFiles: files, parsedSubgraph: subgraph})

    for (const community of subgraph.touchedCommunities) {
        const msbScore = msb.perCommunity[community] ?? 0
        const igScore = ig.perCommunity[community] ?? 0
        const aprScore = apr.perCommunity[community] ?? 0
        console.log(
            `  community=${community}`,
            `  module-state-bindings=${msbScore}`,
            `  implicit-globals=${igScore}`,
            `  ast-purity-ratio=${aprScore.toFixed(2)}`,
        )
    }
    for (const v of ig.violations.slice(0, 1)) {
        console.log(`    [implicit-globals] ${v.severity}: ${v.message}`)
    }
    for (const v of apr.violations.slice(0, 1)) {
        console.log(`    [ast-purity-ratio] ${v.severity}: ${v.message}`)
    }
}

async function main(): Promise<void> {
    console.log('Behavioral measure sanity check — three communities ranged across the impurity spectrum.\n')
    for (const c of COMMUNITIES) await probe(c.community, c.expectation, c.dir)
}

main().catch(err => { console.error(err); process.exit(1) })
