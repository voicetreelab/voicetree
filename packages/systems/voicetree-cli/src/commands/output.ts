/**
 * Pure CLI error shape. `error(msg)` throws this; the entry-point catch in
 * voicetree-cli.ts maps it to `setErrorClass('CliError') + console.error +
 * process.exit(1)` — keeping the process-side effects at the boundary so
 * the rest of the CLI is pure to the transitive-purity gate.
 */
export class CliError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'CliError'
    }
}

export function isJsonMode(): boolean {
    return process.argv.includes('--json') || !process.stdout.isTTY
}

export function output<T>(data: T, humanFormat?: (data: T) => string): void {
    if (isJsonMode()) {
        console.log(JSON.stringify(data, null, 2))
        return
    }

    console.log(humanFormat ? humanFormat(data) : JSON.stringify(data, null, 2))
}

export function error(message: string): never {
    throw new CliError(message)
}
