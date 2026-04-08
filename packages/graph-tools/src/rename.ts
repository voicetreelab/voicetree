import { runGraphMove } from './move'

export async function graphRename(
    _port: number,
    _terminalId: string | undefined,
    args: string[]
): Promise<void> {
    await runGraphMove(args, {
        usage: 'Usage: vt graph rename <old-path> <new-path> [--dry-run] [--vault PATH]',
        verb: 'Renamed',
        dryRunVerb: 'Would rename',
        requireFile: true,
    })
}
