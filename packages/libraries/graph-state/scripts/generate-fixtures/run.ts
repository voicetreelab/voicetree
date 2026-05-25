import { promises as fs } from 'fs'
import path from 'path'

import {
    FIXTURES_DIR,
    PROJECTIONS_DIR,
    REAL_VAULT_CANONICAL_ROOT,
    REAL_VAULT_FIXTURE_ID,
    SEQUENCES_DIR,
    SNAPSHOTS_DIR,
    hydrateState,
    snapshotStateFromVault,
    toFixtureJson,
    type ProjectionDocument,
} from '../../src/fixtures.ts'
import { project } from '../../src/project.ts'
import { createFixtureDocuments } from './documents.ts'
import { configureFixtureRootIO, resolveFolderNodesVault } from './root-io.ts'

async function writeJson(filePath: string, value: unknown): Promise<void> {
    await fs.writeFile(filePath, toFixtureJson(value), 'utf8')
}

export async function runGenerateFixtures(): Promise<void> {
    configureFixtureRootIO()
    await fs.mkdir(FIXTURES_DIR, { recursive: true })
    await fs.rm(SNAPSHOTS_DIR, { recursive: true, force: true })
    await fs.rm(SEQUENCES_DIR, { recursive: true, force: true })
    await fs.rm(PROJECTIONS_DIR, { recursive: true, force: true })
    await fs.mkdir(SNAPSHOTS_DIR, { recursive: true })
    await fs.mkdir(SEQUENCES_DIR, { recursive: true })
    await fs.mkdir(PROJECTIONS_DIR, { recursive: true })

    const { snapshots, sequences } = createFixtureDocuments()
    const realVaultSnapshot = await snapshotStateFromVault(
        resolveFolderNodesVault(),
        {
            id: REAL_VAULT_FIXTURE_ID,
            description: 'Canonicalized real-vault snapshot sourced from brain/working-memory/tasks/folder-nodes.',
            canonicalRoot: REAL_VAULT_CANONICAL_ROOT,
        },
    )

    const allSnapshots = [...snapshots, realVaultSnapshot]

    for (const doc of allSnapshots) {
        await writeJson(path.join(SNAPSHOTS_DIR, `${doc.id}.json`), doc)
    }

    for (const doc of sequences) {
        await writeJson(path.join(SEQUENCES_DIR, `${doc.id}.json`), doc)
    }

    for (const doc of allSnapshots) {
        const projectionDocument: ProjectionDocument = {
            $schema: 'graph-state/projection@1',
            id: doc.id,
            sourceSnapshot: doc.id,
            elementSpec: project(hydrateState(doc.state)),
        }
        await writeJson(path.join(PROJECTIONS_DIR, `${doc.id}.json`), projectionDocument)
    }

    console.log(
        `Generated ${snapshots.length + 1} snapshots and ${sequences.length} sequences in ${FIXTURES_DIR}`,
    )
}
