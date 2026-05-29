import { runGraphMove } from './move'

export async function graphRename(
    _terminalId: string | undefined,
    args: string[]
): Promise<void> {
    await runGraphMove(args, {
        usage: 'Usage: vt graph rename <old-path> <new-path> [--dry-run] [--project PATH]',
        verb: 'Renamed',
        dryRunVerb: 'Would rename',
        requireFile: true,
    })
}
