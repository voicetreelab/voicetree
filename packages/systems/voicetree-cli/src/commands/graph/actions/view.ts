import {graphStructure} from './structure'

export async function graphView(terminalId: string | undefined, args: string[]): Promise<void> {
    console.error('Warning: `vt graph view` is deprecated. Use `vt graph structure` instead.')
    await graphStructure(terminalId, args)
}
