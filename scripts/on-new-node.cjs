#!/usr/bin/env node
// on-new-node.cjs
// Batches new node paths and spawns agents via MCP at different thresholds.
//
// Called by VoiceTree's onNewNode hook after a new graph node is written to disk.
// Agent 1 (muse): every 3 nodes — expands thinking, surfaces missed aspects
// Agent 2 (gardener): every 5 nodes — fixes orphans, bad connections, wrong splits/merges
// Agent 3 (dispatcher): every 1 node — detects explicit user commands in transcript and executes them
//
// Usage: node on-new-node.cjs <nodePath>
// Env (required, set by buildTerminalEnvVars when hook terminal is spawned):
//   VOICETREE_MCP_PORT              - MCP server port (errors if missing)
//   VOICETREE_CALLER_TERMINAL_ID    - Terminal ID for agent spawning (errors if missing)

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
Use create_graph. The node TITLE should name the single most important finding.

**Node structure — most critical info first:**
- **summary field**: 1-3 bullet points. Lead with your #1 finding. Include your importance score (e.g. "Score: 6/10"). No filler.
- **content field**: Expand on each point with evidence/reasoning. Keep paragraphs short (2-3 sentences max).

Focus on what's most useful:
- Connections between nodes the user might not see
- Unstated assumptions or risks worth flagging
- Promising directions worth developing further
- Alternative approaches not yet considered

Don't restate what's already in the nodes. No preamble ("I noticed that..."). Start with the insight.

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
            return `You are a graph-improver agent. Voice-to-graph can produce messy results. Silently fix the recent batch of nodes.

## Step 1: Read transcript tail
Read the TAIL (last 2000 chars) of: ${transcriptPath}

## Step 2: Read recent nodes
${nodeList}
Note title, content, and connections ([[wikilinks]] and frontmatter parents).
List files in this folder sorted by recently created / modified.

## Step 3: Search for nearby nodes
Use search_nodes to find related nodes these might connect to.

## Step 4: Score importance (1-10)
How messy is this batch? Orphans, wrong links, bad splits/merges?

- **1-3**: Graph looks fine. Skip to Step 6.
- **4-6**: Minor fixes needed. Fix them (Step 5), then Step 6.
- **7+**: Significant structural problems. Fix them (Step 5). Do NOT close yourself.

## Step 5: Fix issues (only if score >= 4)
Edit markdown files directly to fix:
- **Orphan nodes** (no existing connections at all): add a [[link]] to place them in the tree.
- **Incorrect connections**: correct the wrong edge only — do not add new edges.
- **Wrong splits** (merge) or **wrong merges** (split).

Edge rules — strictly follow these:
- Only ADD an edge if the node is a true orphan (zero existing connections).
- Only CHANGE an edge if it is clearly wrong.
- Never add edges to nodes that are already connected, even if a new connection seems useful.

NEVER create progress nodes — not for fixes, not for problems, not for anything. Fix silently and close yourself.

## Step 6: Close yourself (only if score < 7)
Use close_agent with your own terminal ID (from $VOICETREE_TERMINAL_ID) as both callerTerminalId and terminalId.`
        },
    },
    {
        name: 'dispatcher',
        batchFile: '/tmp/voicetree-new-nodes-dispatcher.txt',
        threshold: 1,
        taskTitle: 'Check transcript for user command',
        buildPrompt: (nodeList, vaultDir) => {
            const transcriptPath = path.join(vaultDir, 'transcript_history.txt')
            return `You are a command dispatcher. Your ONLY job: detect if the user's voice transcript contains an explicit command that should be executed via voicetree MCP tools, and if so, execute it.

## Step 1: Read transcript tail
Read the TAIL (last 1500 chars) of: ${transcriptPath}

## Step 2: Read the new node
${nodeList}

## Step 3: Score user action intent

Analyze the transcript for an EXPLICIT user command directed at voicetree/agents. Score intent:

- **non-existent**: No action requested at all. Normal thinking/discussion.
- **low**: Vague language like "hmm let's look into that", "that's interesting", "we could maybe...". No clear directive.
- **medium**: Somewhat directed but ambiguous. "we should probably check that" — unclear if talking to voicetree or thinking aloud.
- **high**: Clear directive to take action. "okay spawn an agent to investigate that", "voicetree research X", "let's have an agent look at Y".
- **obvious**: Unmistakable direct command. "spawn an agent now", "please search for X", "create a node about Y", "run search_nodes for Z".

Examples:
- "okay let's spawn an agent now to investigate that" → **obvious** (direct command to spawn)
- "voicetree please research that" → **high** (directed at voicetree, clear action)
- "hmm okay let's look into that" → **low** (vague, no clear directive)
- "I think the architecture needs work" → **non-existent** (observation, not a command)
- "we should search for related nodes" → **medium** (could be thinking aloud)

## Step 4: Act ONLY if high or obvious

If score is **non-existent, low, or medium**: Skip to Step 5 immediately. Do NOT create any nodes or take any action.

If score is **high or obvious**: Execute the user's command using the appropriate voicetree MCP tool. Common mappings:
- "spawn an agent" / "investigate" / "research" / "look into" → spawn_agent
- "search for" / "find nodes about" → search_nodes
- "create a node" → create_graph

Use your best judgment to map the user's intent to the right MCP tool and parameters. If spawning an agent, extract the topic/task from the transcript context.

## Step 5: Close yourself
Use close_agent with your own terminal ID (from $VOICETREE_TERMINAL_ID) as both callerTerminalId and terminalId.
ALWAYS close yourself — even after executing a command. You are a one-shot dispatcher.`
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
                    nodeId: firstNode,
                    details: agent.buildPrompt(nodeList, vaultDir),
                    callerTerminalId: TERMINAL_ID,
                    promptTemplate: 'AGENT_PROMPT_LIGHTWEIGHT',
                },
            },
        }

        spawns.push(spawnAgentViaMcp(payload))
    }

    // Wait for all MCP requests to complete before exiting
    await Promise.all(spawns)
})()
