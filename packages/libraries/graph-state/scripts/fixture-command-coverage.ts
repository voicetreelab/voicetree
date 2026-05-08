import { listSequenceDocuments } from '../src/fixtures'

const REQUIRED_COMMANDS = [
    'Collapse',
    'Expand',
    'Select',
    'Deselect',
    'AddNode',
    'RemoveNode',
    'AddEdge',
    'RemoveEdge',
    'Move',
    'LoadRoot',
    'UnloadRoot',
] as const

function main(): void {
    const seen = new Set<string>()

    for (const sequence of listSequenceDocuments()) {
        for (const command of sequence.doc.commands) {
            seen.add(command.type)
        }
    }

    const missing = REQUIRED_COMMANDS.filter((command) => !seen.has(command))
    if (missing.length > 0) {
        throw new Error(`Missing command coverage for: ${missing.join(', ')}`)
    }

    console.log(`Commands covered: ${seen.size}/${REQUIRED_COMMANDS.length}`)
}

main()
