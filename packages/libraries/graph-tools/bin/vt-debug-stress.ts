#!/usr/bin/env npx tsx

import { handler } from './vt-debug-stress/handler'

const result = await handler(process.argv.slice(2))

process.stdout.write(JSON.stringify(result) + '\n')
process.exit(result.ok ? 0 : result.exitCode ?? 1)
