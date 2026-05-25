import { runGenerateFixtures } from './generate-fixtures/run.ts'

runGenerateFixtures().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error)
    console.error(message)
    process.exitCode = 1
})
