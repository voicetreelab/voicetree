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
    console.error(`error: ${message}`)
    process.exit(1)
}
