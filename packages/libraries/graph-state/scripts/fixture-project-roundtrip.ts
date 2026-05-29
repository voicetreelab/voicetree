import path from 'path'

import {
    REAL_PROJECT_CANONICAL_ROOT,
    REAL_PROJECT_FIXTURE_ID,
    readSnapshotDocument,
    snapshotStateFromProject,
    toFixtureJson,
} from '../src/fixtures'

async function main(): Promise<void> {
    const sourceProjectPath = process.argv[2]
    if (!sourceProjectPath) {
        throw new Error('Usage: npx tsx packages/libraries/graph-state/scripts/fixture-project-roundtrip.ts <project-path>')
    }

    const expected = readSnapshotDocument(REAL_PROJECT_FIXTURE_ID)
    const actual = await snapshotStateFromProject(path.resolve(sourceProjectPath), {
        id: expected.id,
        description: expected.description,
        canonicalRoot: REAL_PROJECT_CANONICAL_ROOT,
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
