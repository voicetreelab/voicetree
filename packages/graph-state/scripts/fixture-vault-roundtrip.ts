import path from 'path'

import {
    REAL_VAULT_CANONICAL_ROOT,
    REAL_VAULT_FIXTURE_ID,
    readSnapshotDocument,
    snapshotStateFromVault,
    toFixtureJson,
} from '../src/fixtures'

async function main(): Promise<void> {
    const sourceVaultPath = process.argv[2]
    if (!sourceVaultPath) {
        throw new Error('Usage: npx tsx packages/graph-state/scripts/fixture-vault-roundtrip.ts <vault-path>')
    }

    const expected = readSnapshotDocument(REAL_VAULT_FIXTURE_ID)
    const actual = await snapshotStateFromVault(path.resolve(sourceVaultPath), {
        id: expected.id,
        description: expected.description,
        canonicalRoot: REAL_VAULT_CANONICAL_ROOT,
    })

    if (toFixtureJson(expected) !== toFixtureJson(actual)) {
        throw new Error('Roundtrip mismatch')
    }

    console.log('Roundtrip match')
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error)
    console.error(message)
    process.exitCode = 1
})
