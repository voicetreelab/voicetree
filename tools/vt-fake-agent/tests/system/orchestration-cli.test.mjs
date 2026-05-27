import assert from 'node:assert/strict'
import {spawn, spawnSync} from 'node:child_process'
import {once} from 'node:events'
import test from 'node:test'
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {createMcpExpressApp} from '@modelcontextprotocol/sdk/server/express.js'
import * as z from 'zod/v4'

const packageRoot = new URL('../..', import.meta.url)

function toolResult(value) {
  return {
    content: [{type: 'text', text: JSON.stringify(value)}],
  }
}

function createFakeVoicetreeMcpServer() {
  const calls = []
  const children = new Map()
  let childIndex = 0

  const createServer = () => {
    const server = new McpServer({name: 'fake-voicetree-mcp', version: '1.0.0'})

    server.registerTool(
      'create_graph',
      {
        inputSchema: {
          callerTerminalId: z.string(),
          nodes: z.array(z.object({
            filename: z.string(),
            title: z.string(),
            summary: z.string(),
            content: z.string().optional(),
            color: z.string().optional(),
          })),
        },
      },
      (args) => {
        calls.push({name: 'create_graph', args})
        return toolResult({success: true})
      },
    )

    server.registerTool(
      'spawn_agent',
      {
        inputSchema: {
          callerTerminalId: z.string(),
          task: z.string(),
          parentNodeId: z.string(),
          depthBudget: z.number().optional(),
          headless: z.boolean().optional(),
        },
      },
      (args) => {
        const terminalId = `child-${++childIndex}`
        children.set(terminalId, 'exited')
        calls.push({name: 'spawn_agent', args: {...args, terminalId}})
        return toolResult({terminalId})
      },
    )

    server.registerTool(
      'list_agents',
      {},
      () => toolResult([...children].map(([terminalId, status]) => ({
        terminalId,
        agentName: 'fake-child',
        status,
      }))),
    )

    server.registerTool(
      'wait_for_agents',
      {
        inputSchema: {
          callerTerminalId: z.string(),
          terminalIds: z.array(z.string()),
          pollIntervalMs: z.number().optional(),
        },
      },
      (args) => {
        calls.push({name: 'wait_for_agents', args})
        return toolResult({status: 'monitoring', terminalIds: args.terminalIds})
      },
    )

    server.registerTool(
      'send_message',
      {
        inputSchema: {
          callerTerminalId: z.string(),
          terminalId: z.string(),
          message: z.string(),
        },
      },
      (args) => {
        calls.push({name: 'send_message', args})
        return toolResult({success: true})
      },
    )

    server.registerTool(
      'close_agent',
      {
        inputSchema: {
          callerTerminalId: z.string(),
          terminalId: z.string(),
        },
      },
      (args) => {
        calls.push({name: 'close_agent', args})
        return toolResult({success: true})
      },
    )

    return server
  }

  const app = createMcpExpressApp()
  app.post('/mcp', async (req, res) => {
    const server = createServer()
    const transport = new StreamableHTTPServerTransport({sessionIdGenerator: undefined})
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
    res.on('close', () => {
      transport.close()
      server.close()
    })
  })

  return {app, calls}
}

function runFakeAgent(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['dist/index.js'], {
      cwd: packageRoot,
      env: {...process.env, ...env},
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`fake agent timed out\nstdout:\n${stdout}\nstderr:\n${stderr}`))
    }, 10000)

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.on('exit', (code) => {
      clearTimeout(timeout)
      resolve({code, stdout, stderr})
    })
  })
}

test('vt-fake-agent runs an orchestration script through its CLI and MCP boundary', async () => {
  const build = spawnSync('npm', ['run', 'build'], {
    cwd: packageRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  })
  assert.equal(build.status, 0, `${build.stdout ?? ''}${build.stderr ?? ''}`)

  const {app, calls} = createFakeVoicetreeMcpServer()
  const httpServer = app.listen(0)
  await once(httpServer, 'listening')

  try {
    const {port} = httpServer.address()
    const script = {
      actions: [
        {type: 'log', message: 'parent starting'},
        {
          type: 'spawn_child',
          task: 'Worker child task',
          childScript: {
            actions: [
              {
                type: 'create_nodes',
                nodes: [{title: 'Worker Output', summary: 'Worker finished.'}],
              },
              {type: 'exit', code: 0},
            ],
          },
          headless: true,
        },
        {type: 'wait_for_children'},
        {
          type: 'create_nodes',
          nodes: [{title: 'Orchestration Complete', summary: 'Parent observed child completion.'}],
        },
        {type: 'exit', code: 0},
      ],
    }

    const result = await runFakeAgent({
      VOICETREE_TERMINAL_ID: 'test-parent',
      VOICETREE_MCP_PORT: String(port),
      TASK_NODE_PATH: '/tmp/fake-task.md',
      AGENT_PROMPT: `### FAKE_AGENT_SCRIPT ###\n${JSON.stringify(script)}\n### END_FAKE_AGENT_SCRIPT ###`,
    })

    assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, /Spawned child: child-1/)
    assert.match(result.stdout, /All children done: child-1=exited/)

    const spawnCall = calls.find((call) => call.name === 'spawn_agent')
    assert.ok(spawnCall, `calls: ${JSON.stringify(calls, null, 2)}`)
    assert.equal(spawnCall.args.callerTerminalId, 'test-parent')
    assert.equal(spawnCall.args.parentNodeId, '/tmp/fake-task.md')
    assert.equal(spawnCall.args.headless, true)
    assert.match(spawnCall.args.task, /FAKE_AGENT_SCRIPT/)

    const createdTitles = calls
      .filter((call) => call.name === 'create_graph')
      .flatMap((call) => call.args.nodes.map((node) => node.title))
    assert.deepEqual(createdTitles, ['Orchestration Complete'])
  } finally {
    await new Promise((resolve, reject) => {
      httpServer.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }
})
