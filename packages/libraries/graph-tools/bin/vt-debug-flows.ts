#!/usr/bin/env npx tsx

import { exitCodeForResult, handler, printRunAllSummary } from './vt-debug-flows/handler'

const result = await handler(process.argv.slice(2))

printRunAllSummary(result)
process.stdout.write(JSON.stringify(result) + '\n')
process.exit(exitCodeForResult(result))
