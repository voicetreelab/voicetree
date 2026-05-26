import { existsSync, readFileSync } from 'node:fs'

export async function readMcpPort(mcpJsonPath: string, timeoutMs: number): Promise<number> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        if (existsSync(mcpJsonPath)) {
            try {
                const raw = readFileSync(mcpJsonPath, 'utf8')
                const parsed = JSON.parse(raw) as { mcpServers?: Record<string, { url?: string }> }
                const url = parsed.mcpServers?.voicetree?.url
                if (typeof url === 'string') {
                    const m = url.match(/:(\d+)\/mcp$/)
                    if (m) return Number.parseInt(m[1], 10)
                }
            } catch {
                // file mid-write; try again
            }
        }
        await new Promise(r => setTimeout(r, 250))
    }
    throw new Error(`timed out waiting for ${mcpJsonPath} with mcpServers.voicetree.url`)
}
