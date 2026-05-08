import { promises as fs } from 'fs'
import path from 'path'

import { PROJECTIONS_DIR, listSnapshotDocuments, toFixtureJson } from '../src/fixtures.ts'
import { project } from '../src/project.ts'

async function main(): Promise<void> {
    const snapshots = listSnapshotDocuments()
    const snapshotIds = new Set(snapshots.map(({ doc }) => doc.id))

    await fs.mkdir(PROJECTIONS_DIR, { recursive: true })

    const existingFiles = await fs.readdir(PROJECTIONS_DIR)
    await Promise.all(
        existingFiles
            .filter((fileName) => fileName.endsWith('.json'))
            .filter((fileName) => !snapshotIds.has(path.basename(fileName, '.json')))
            .map((fileName) => fs.unlink(path.join(PROJECTIONS_DIR, fileName))),
    )

    for (const { doc, state } of snapshots) {
        const projectionDocument = {
            $schema: 'graph-state/projection@1' as const,
            id: doc.id,
            sourceSnapshot: doc.id,
            elementSpec: project(state),
        }

        await fs.writeFile(
            path.join(PROJECTIONS_DIR, `${doc.id}.json`),
            toFixtureJson(projectionDocument),
            'utf8',
        )
    }
}

void main()
