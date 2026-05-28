// One-shot diagnostic: run the production name-uniqueness policy
// against every declared name in the repo (scope = all declarations,
// not just newly-introduced ones) and report what would be flagged.
// Lets us verify post-allowlist + graph-distance filtering matches the
// spike's intersect-mode expectations.

import {buildNameUniquenessContext} from '../src/_shared/name-uniqueness/build-context.ts'
import {findNameUniquenessViolations} from '../src/_shared/name-uniqueness/find-violations.ts'

async function main(): Promise<void> {
    const context = await buildNameUniquenessContext({cacheKey: null})
    const allDeclarations = context.index.declarations

    const violations = findNameUniquenessViolations({
        scope: allDeclarations,
        index: context.index,
        allowlist: context.allowlist,
        importGraph: context.importGraph,
    })

    console.log(`Total declarations scanned: ${allDeclarations.length}`)
    console.log(`Total violations (scope = entire repo): ${violations.length}`)

    const byCluster = new Map<string, typeof violations>()
    for (const v of violations) {
        const key = v.significantTokens.join('|')
        const list = byCluster.get(key) ?? []
        list.push(v)
        byCluster.set(key, list)
    }

    const clusters = [...byCluster.entries()]
        .map(([key, vs]) => ({tokens: key.split('|'), violations: vs}))
        .sort((a, b) => b.violations.length - a.violations.length)

    console.log(`\nTop 20 flagged token-sets:`)
    for (const [i, c] of clusters.slice(0, 20).entries()) {
        console.log(`  #${i + 1}  [${c.tokens.join(', ')}]  ${c.violations.length} violations`)
        for (const v of c.violations.slice(0, 3)) {
            console.log(`      ${v.declaration.name}  ${v.declaration.filePath}`)
        }
        if (c.violations.length > 3) console.log(`      … +${c.violations.length - 3} more`)
    }
}

main().catch(err => {
    console.error(err)
    process.exit(1)
})
