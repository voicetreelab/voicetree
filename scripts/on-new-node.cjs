#!/usr/bin/env node
// on-new-node.cjs
// Batches new node paths and spawns agents via MCP at different thresholds.
//
// Called by VoiceTree's onNewNode hook after a new graph node is written to disk.
// Agent 1 (muse): every 3 nodes — expands thinking, surfaces missed aspects
// Agent 2 (gardener): every 5 nodes — fixes orphans, bad connections, wrong splits/merges
//
// Usage: node on-new-node.cjs <nodePath>
// Env:
//   VOICETREE_MCP_PORT              - MCP server port (default: 3001)
//   VOICETREE_CALLER_TERMINAL_ID    - Terminal ID for agent spawning (default: hook-watcher)

'use strict'

const fs = require('fs')
const path = require('path')
const http = require('http')

const nodePath = process.argv[2]
if (!nodePath) {
    process.stderr.write('Usage: on-new-node.cjs <nodePath>\n')
    process.exit(1)
}

// Skip context nodes (auto-generated, not user content)
if (nodePath.includes('/ctx-nodes/')) {
    process.exit(0)
}

const MCP_PORT = process.env.VOICETREE_MCP_PORT || '3001'
const TERMINAL_ID = process.env.VOICETREE_CALLER_TERMINAL_ID || 'hook-watcher'

// --- Agent definitions ---

const agents = [
    {
        name: 'muse',
        batchFile: '/tmp/voicetree-new-nodes-thinking.txt',
        threshold: 3,
        taskTitle: 'Expand thinking on recent nodes',
        buildPrompt: (nodeList, _vaultDir) =>
`You are a background thinking partner. Read recent nodes and decide if you have anything worth saying.

## Step 1: Read these nodes
${nodeList}

## Step 2: Score importance (1-10)
Consider: Are there missed angles, unstated assumptions, connections between ideas, risks, or promising directions worth expanding?

- **1-3**: Nothing non-obvious to add. Skip to Step 4.
- **4-6**: One meaningful insight. Create ONE concise node (Step 3), then Step 4.
- **7+**: Multiple important insights. Create multiple nodes (Step 3). Do NOT close yourself.

## Step 3: Create nodes (only if score >= 4)
Use create_graph. Focus on what's most useful:
- Connections between nodes the user might not see
- Unstated assumptions or risks worth flagging
- Promising directions worth developing further
- Alternative approaches not yet considered

Be concise. Don't restate what's already in the nodes.

## Step 4: Close yourself (only if score < 7)
Use close_agent with your own terminal ID (from $VOICETREE_TERMINAL_ID) as both callerTerminalId and terminalId.`,
    },
    {
        name: 'gardener',
        batchFile: '/tmp/voicetree-new-nodes-gardening.txt',
        threshold: 5,
        taskTitle: 'Graph improver: fix connections in recent nodes',
        buildPrompt: (nodeList, vaultDir) => {
            const transcriptPath = path.join(vaultDir, 'transcript_history.txt')
            return `You are a graph-improver agent. Voice-to-graph can produce messy results. Fix the recent batch of nodes.

## Step 1: Read transcript tail
Read the TAIL (last 2000 chars) of: ${transcriptPath}

## Step 2: Read recent nodes
${nodeList}
Note title, content, and connections ([[wikilinks]] and frontmatter parents).

## Step 3: Search for nearby nodes
Use search_nodes to find related nodes these might connect to.

## Step 4: Score importance (1-10)
How messy is this batch? Orphans, wrong links, bad splits/merges?

- **1-3**: Graph looks fine. Skip to Step 6.
- **4-6**: Minor fixes needed. Fix them (Step 5), then Step 6.
- **7+**: Significant structural problems. Fix them (Step 5). Do NOT close yourself.

## Step 5: Fix issues (only if score >= 4)
Edit markdown files to fix: orphan nodes (add [[links]]), incorrect connections, wrong splits (merge), wrong merges (split).
Use create_graph to document what you fixed.

## Step 6: Close yourself (only if score < 7)
Use close_agent with your own terminal ID (from $VOICETREE_TERMINAL_ID) as both callerTerminalId and terminalId.`
        },
    },
]

// --- Helpers ---

/** Append a line to a file (creates if missing) */
function appendLine(filePath, line) {
    fs.appendFileSync(filePath, line + '\n')
}

/** Read all non-empty lines from a file */
function readLines(filePath) {
    if (!fs.existsSync(filePath)) return []
    return fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean)
}

/** Truncate a file to zero bytes */
function truncate(filePath) {
    fs.writeFileSync(filePath, '')
}

/** POST to MCP and log the response. Returns a promise so the process stays alive until the response arrives. */
function spawnAgentViaMcp(payload) {
    const data = JSON.stringify(payload)
    return new Promise((resolve) => {
        const req = http.request({
            hostname: '127.0.0.1',
            port: parseInt(MCP_PORT, 10),
            path: '/mcp',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/event-stream',
                'Content-Length': Buffer.byteLength(data),
            },
        }, (res) => {
            let body = ''
            res.on('data', (chunk) => { body += chunk })
            res.on('end', () => {
                if (res.statusCode >= 400) {
                    process.stderr.write(`[on-new-node] MCP HTTP ${res.statusCode}: ${body}\n`)
                } else {
                    try {
                        const parsed = JSON.parse(body)
                        if (parsed.error || parsed.result?.isError) {
                            process.stderr.write(`[on-new-node] MCP error: ${body}\n`)
                        }
                    } catch { /* not JSON, ignore */ }
                }
                resolve()
            })
        })
        req.on('error', (err) => {
            process.stderr.write(`[on-new-node] MCP request failed: ${err.message}\n`)
            resolve()
        })
        req.write(data)
        req.end()
    })
}

// --- Main logic ---

;(async () => {
    // Append to ALL batch files
    for (const agent of agents) {
        appendLine(agent.batchFile, nodePath)
    }

    // Check each agent independently
    const spawns = []
    for (const agent of agents) {
        const lines = readLines(agent.batchFile)
        if (lines.length < agent.threshold) continue

        // Threshold reached — consume batch
        truncate(agent.batchFile)

        const firstNode = lines[0]
        const vaultDir = path.dirname(firstNode)
        const nodeList = lines.map((p) => '- ' + p).join('\n')

        const payload = {
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
                name: 'spawn_agent',
                arguments: {
                    task: agent.taskTitle,
                    details: agent.buildPrompt(nodeList, vaultDir),
                    parentNodeId: firstNode,
                    callerTerminalId: TERMINAL_ID,
                },
            },
        }

        spawns.push(spawnAgentViaMcp(payload))
    }

    // Wait for all MCP requests to complete before exiting
    await Promise.all(spawns)
})()
