#!/usr/bin/env node
// on-new-node.cjs
// Batches new node paths and spawns agents via MCP at different thresholds.
//
// Called by VoiceTree's onNewNode hook after a new graph node is written to disk.
// Agent 1 (muse): every 3 nodes — expands thinking, surfaces missed aspects
// Agent 2 (gardener): every 5 nodes — fixes orphans, bad connections, wrong splits/merges
// Agent 3 (dispatcher): every 1 node — detects explicit user commands in transcript and delegates via spawn_agent
//
// Usage: node on-new-node.cjs <nodePath>
// Env (required, set by buildTerminalEnvVars when hook terminal is spawned):
//   VOICETREE_MCP_PORT              - MCP server port (errors if missing)
//   VOICETREE_CALLER_TERMINAL_ID    - Terminal ID for agent spawning (errors if missing)
//   VOICETREE_VAULT_PATH            - Vault root directory (used by spawned agents, not this script)

'use strict'

const fs = require('fs')
const path = require('path')
const http = require('http')

const PROMPTS_DIR = path.join(__dirname, 'prompts')

/** Load a prompt template from scripts/prompts/<name>.md and substitute {{NODE_LIST}} */
function loadPrompt(name, nodeList) {
    const filePath = path.join(PROMPTS_DIR, `${name}.md`)
    const template = fs.readFileSync(filePath, 'utf8')
    return template.replace('{{NODE_LIST}}', nodeList)
}

const nodePath = process.argv[2]
if (!nodePath) {
    process.stderr.write('Usage: on-new-node.cjs <nodePath>\n')
    process.exit(1)
}

// Skip context nodes (auto-generated, not user content)
if (nodePath.includes('/ctx-nodes/')) {
    process.exit(0)
}

// Only run hooks for nodes in a /voice/ folder (voice transcription output)
if (!nodePath.includes('/voice/')) {
    process.exit(0)
}

const MCP_PORT = process.env.VOICETREE_MCP_PORT
if (!MCP_PORT) {
    process.stderr.write('[on-new-node] VOICETREE_MCP_PORT env var is not set. Hook terminal env may be stale.\n')
    process.exit(1)
}
const TERMINAL_ID = process.env.VOICETREE_CALLER_TERMINAL_ID
if (!TERMINAL_ID) {
    process.stderr.write('[on-new-node] VOICETREE_CALLER_TERMINAL_ID env var is not set. Hook terminal env may be stale.\n')
    process.exit(1)
}

// --- Agent definitions ---

const agents = [
    {
        name: 'muse',
        batchFile: '/tmp/voicetree-new-nodes-thinking.txt',
        threshold: 3,
        taskTitle: 'Expand thinking on recent nodes',
    },
    {
        name: 'gardener',
        batchFile: '/tmp/voicetree-new-nodes-gardening.txt',
        threshold: 5,
        taskTitle: 'Graph improver: fix connections in recent nodes',
    },
    {
        name: 'dispatcher',
        batchFile: '/tmp/voicetree-new-nodes-dispatcher.txt',
        threshold: 1,
        taskTitle: 'Check transcript for user command',
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
        const nodeList = lines.map((p) => '- ' + p).join('\n')

        const payload = {
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
                name: 'spawn_agent',
                arguments: {
                    nodeId: firstNode,
                    details: loadPrompt(agent.name, nodeList),
                    callerTerminalId: TERMINAL_ID,
                    promptTemplate: 'AGENT_PROMPT_LIGHTWEIGHT',
                    agentName: 'Claude Sonnet',
                },
            },
        }

        spawns.push(spawnAgentViaMcp(payload))
    }

    // Wait for all MCP requests to complete before exiting
    await Promise.all(spawns)
})()
