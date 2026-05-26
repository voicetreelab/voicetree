type VitestFailedTestSummary = {
    readonly fileName?: string
    readonly fullName: string
    readonly message: string
}

type VitestFailureDetails = {
    readonly failedTests: readonly VitestFailedTestSummary[]
    readonly failedTestsTruncated: boolean
}

type VitestFailureDetailLimits = {
    readonly maxFailures: number
    readonly maxMessageChars: number
    readonly maxTotalMessageChars: number
}

type JsonObject = {
    readonly [key: string]: unknown
}

const DEFAULT_LIMITS: VitestFailureDetailLimits = {
    maxFailures: 20,
    maxMessageChars: 1_000,
    maxTotalMessageChars: 8_000,
}

const UNKNOWN_FAILED_TEST_MESSAGE = 'Vitest reported this test as failed without a failure message.'
const UNKNOWN_TEST_NAME = '(unknown test)'

export function vitestOutputFileFromArgs(args: readonly string[]): string | null {
    for (let index = 0; index < args.length; index++) {
        const arg = args[index]
        if (arg.startsWith('--outputFile=')) return arg.slice('--outputFile='.length) || null
        if (arg === '--outputFile') return args[index + 1] || null
    }
    return null
}

export function extractVitestFailureDetails(json: unknown, limits: VitestFailureDetailLimits = DEFAULT_LIMITS): VitestFailureDetails | null {
    const root = asObject(json)
    const testResults = asArray(root?.testResults)
    if (!testResults) return null

    const failedTests: VitestFailedTestSummary[] = []
    let totalMessageChars = 0
    let truncated = false

    for (const testResultValue of testResults) {
        const testResult = asObject(testResultValue)
        const assertions = asArray(testResult?.assertionResults)
        if (!testResult || !assertions) continue

        const fileName = firstString(testResult.name, testResult.fileName, testResult.testFilePath)
        for (const assertionValue of assertions) {
            const assertion = asObject(assertionValue)
            if (!assertion || !isFailedAssertion(assertion)) continue

            if (failedTests.length >= limits.maxFailures || totalMessageChars >= limits.maxTotalMessageChars) {
                truncated = true
                continue
            }

            const messageBudget = Math.min(limits.maxMessageChars, limits.maxTotalMessageChars - totalMessageChars)
            const message = boundedMessage(firstFailureMessage(assertion), messageBudget)
            totalMessageChars += message.text.length
            truncated = truncated || message.truncated

            failedTests.push(withOptionalFileName({
                fileName,
                fullName: fullNameFor(assertion),
                message: message.text,
            }))
        }
    }

    if (failedTests.length === 0) return null
    return {failedTests, failedTestsTruncated: truncated}
}

function asObject(value: unknown): JsonObject | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as JsonObject
        : null
}

function asArray(value: unknown): readonly unknown[] | null {
    return Array.isArray(value) ? value : null
}

function stringOrUndefined(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function firstString(...values: readonly unknown[]): string | undefined {
    return values.map(stringOrUndefined).find((value): value is string => value !== undefined)
}

function isFailedAssertion(assertion: JsonObject): boolean {
    const status = stringOrUndefined(assertion.status)?.toLowerCase()
    if (status === 'failed' || status === 'fail') return true
    return asArray(assertion.failureMessages)?.length ? true : false
}

function firstFailureMessage(assertion: JsonObject): string {
    const failureMessages = asArray(assertion.failureMessages)
    const firstMessage = failureMessages
        ?.map(stringFromUnknown)
        .find((message): message is string => message !== undefined && message !== '')
    return firstMessage ?? stringFromUnknown(assertion.failureMessage) ?? stringFromUnknown(assertion.message) ?? UNKNOWN_FAILED_TEST_MESSAGE
}

function stringFromUnknown(value: unknown): string | undefined {
    if (typeof value === 'string') return cleanMessage(value)
    if (value instanceof Error) return cleanMessage(value.stack || value.message)
    if (typeof value === 'object' && value !== null && 'message' in value) return cleanMessage(String((value as {message?: unknown}).message ?? ''))
    return undefined
}

function cleanMessage(message: string): string {
    return message
        .split('\n')
        .map(line => line.trimEnd())
        .filter(Boolean)
        .join('\n')
}

function boundedMessage(message: string, maxChars: number): {readonly text: string; readonly truncated: boolean} {
    if (maxChars <= 0) return {text: '', truncated: true}
    if (message.length <= maxChars) return {text: message, truncated: false}
    if (maxChars <= 3) return {text: message.slice(0, maxChars), truncated: true}
    return {text: `${message.slice(0, maxChars - 3)}...`, truncated: true}
}

function fullNameFor(assertion: JsonObject): string {
    const fullName = stringOrUndefined(assertion.fullName)
    if (fullName) return fullName

    const ancestorTitles = asArray(assertion.ancestorTitles)
        ?.map(stringOrUndefined)
        .filter((value): value is string => value !== undefined) ?? []
    const title = firstString(assertion.title, assertion.name)
    const joined = [...ancestorTitles, title].filter((value): value is string => value !== undefined).join(' ')
    return joined || UNKNOWN_TEST_NAME
}

function withOptionalFileName(summary: {readonly fileName: string | undefined; readonly fullName: string; readonly message: string}): VitestFailedTestSummary {
    const fileName = summary.fileName
    return fileName === undefined
        ? {fullName: summary.fullName, message: summary.message}
        : {fileName, fullName: summary.fullName, message: summary.message}
}
