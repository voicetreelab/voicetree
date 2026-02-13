#!/usr/bin/env node
// on-new-node.cjs
// Batches new node paths and spawns TWO agents via MCP at different thresholds.
//
// Called by VoiceTree's onNewNode hook after a new graph node is written to disk.
// Agent 1 (thinking): every 3 nodes — challenges assumptions, suggests alternatives
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
        name: 'thinking',
        batchFile: '/tmp/voicetree-new-nodes-thinking.txt',
        lockFile: '/tmp/voicetree-thinking-agent.lock',
        threshold: 3,
        taskTitle: 'Challenge assumptions in recent nodes',
        buildPrompt: (nodeList, _vaultDir) =>
`You are a critical-thinking agent. Your job is to challenge assumptions and find problems in recent graph nodes.

## Step 1: Read the recent nodes
Read each of these node files:
${nodeList}
For each, note its title, claims, and reasoning.

## Step 2: Challenge assumptions
For each node, ask:
- What assumptions are being made?
- What evidence supports or contradicts these claims?
- Are there alternative approaches not considered?
- What could go wrong with the current direction?

## Step 3: Create a progress node
Use create_graph to document your analysis — what you challenged, what alternatives exist, and any problems found.

## Step 4: Close yourself
When done, use close_agent to shut down your terminal. Pass your own terminal ID (from $VOICETREE_TERMINAL_ID env var) as both callerTerminalId and terminalId.`,
    },
    {
        name: 'gardener',
        batchFile: '/tmp/voicetree-new-nodes-gardening.txt',
        lockFile: '/tmp/voicetree-graph-improver.lock',
        threshold: 5,
        taskTitle: 'Graph improver: fix connections in recent nodes',
        buildPrompt: (nodeList, vaultDir) => {
            const transcriptPath = path.join(vaultDir, 'transcript_history.txt')
            return `You are a graph-improver agent. Voice-to-graph can produce messy results — orphan nodes, incorrect connections, wrong splits or merges. Your job is to fix the recent batch of nodes.

## Step 1: Read the voice transcript (TAIL ONLY)
Read the TAIL (last 2000 characters) of: ${transcriptPath}
This is the raw voice-to-text that produced these nodes. Use it to understand the user's actual intent.

## Step 2: Read the recent nodes
Read each of these node files:
${nodeList}
For each, note its title, content, and wikilink connections ([[double bracket]] links and frontmatter parents).

## Step 3: Search for nearby nodes
Use search_nodes to find related nodes in the graph that these might connect to.

## Step 4: Identify and fix issues
Look for these problems and fix them by editing the markdown files:

**Orphan nodes** — nodes with no [[wikilink]] connections to any other node. Add appropriate [[parent-node]] links.

**Incorrect connections** — [[wikilinks]] that don't make semantic sense given the transcript context. Remove wrong links, add correct ones.

**Wrong splits** — content that should be one node but got split into multiple. If two nodes cover the same single topic, merge the content into one and delete the other file.

**Wrong merges** — a single node covering multiple unrelated topics that should be separate. Split into multiple files with appropriate links.

## Step 5: Create a progress node
Use create_graph to document what you fixed (or that no fixes were needed).

## Step 6: Close yourself
When done, use close_agent to shut down your terminal. Pass your own terminal ID (from $VOICETREE_TERMINAL_ID env var) as both callerTerminalId and terminalId.`
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

/** Check if a PID is alive */
function isPidAlive(pid) {
    try {
        process.kill(pid, 0)
        return true
    } catch {
        return false
    }
}

/** Fire-and-forget HTTP POST to MCP (non-blocking) */
function spawnAgentViaMcp(payload) {
    const data = JSON.stringify(payload)
    const req = http.request({
        hostname: '127.0.0.1',
        port: parseInt(MCP_PORT, 10),
        path: '/mcp',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    })
    req.on('error', () => {}) // swallow — fire and forget
    req.write(data)
    req.end()
    return req
}

// --- Main logic ---

// Append to ALL batch files
for (const agent of agents) {
    appendLine(agent.batchFile, nodePath)
}

// Check each agent independently
for (const agent of agents) {
    const lines = readLines(agent.batchFile)
    if (lines.length < agent.threshold) continue

    // Threshold reached — consume batch
    truncate(agent.batchFile)

    // Rate limit: skip if previous agent still running
    if (fs.existsSync(agent.lockFile)) {
        const pidStr = fs.readFileSync(agent.lockFile, 'utf8').trim()
        const pid = parseInt(pidStr, 10)
        if (!isNaN(pid) && isPidAlive(pid)) {
            // Re-queue paths so they aren't lost
            for (const line of lines) appendLine(agent.batchFile, line)
            continue
        }
        fs.unlinkSync(agent.lockFile)
    }

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

    spawnAgentViaMcp(payload)

    // Store own PID for rate limiting (the node process itself is short-lived,
    // but the HTTP request was fired — use process.pid as a proxy)
    fs.writeFileSync(agent.lockFile, String(process.pid))
}
