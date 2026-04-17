import {
    listSequenceDocuments,
    listSnapshotDocuments,
    loadFixture,
    loadSequence,
    loadSnapshot,
} from '../src/fixtures'

function main(): void {
    const snapshots = listSnapshotDocuments()
    const sequences = listSequenceDocuments()

    for (const snapshot of snapshots) {
        void loadSnapshot(snapshot.doc.id)
    }

    for (const sequence of sequences) {
        void loadSequence(sequence.doc.id)
    }

    const nested = loadFixture('nested-folder')
    if (nested.commands !== undefined || nested.state.roots.folderTree.length === 0) {
        throw new Error('loadFixture("nested-folder") did not return a well-formed snapshot')
    }

    const totalFixtures = snapshots.length + sequences.length
    console.log(`Loaded ${totalFixtures} fixtures, all valid`)
}

main()
