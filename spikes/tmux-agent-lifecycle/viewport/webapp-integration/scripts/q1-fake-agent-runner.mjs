/**
 * BF-208 Q1 fake-agent runner — no-MCP shim around tools/vt-fake-agent.
 *
 * Reuses vt-fake-agent's executor (the real production code path for
 * `log` / `delay` / `exit` actions) but swaps the MCP client for a noop
 * stub so the runner can drive a tmux pane without depending on the VT
 * MCP daemon being up.
 *
 * Why this exists: the original Q1 path ran `claude --print` inside a
 * zsh+p10k shell. The shell's transient prompt redrew over the output
 * before Playwright could screenshot, so the PNG showed only the
 * pre-execution prompt, not the rendered ANSI/Unicode output. By
 * launching this runner as the tmux pane's PID 1 (no shell wrapper),
 * the pane contains only this script's stdout — no prompt redraws.
 */

import { executeScript } from '../../../../../tools/vt-fake-agent/dist/executor.js';

const noopMcpClient = {
  async createGraph() {
    throw new Error('q1-fake-agent-runner: create_node not supported in no-MCP mode');
  },
  async spawnAgent() {
    throw new Error('q1-fake-agent-runner: spawn_child not supported in no-MCP mode');
  },
  async waitForAgents() {
    throw new Error('q1-fake-agent-runner: wait_for_children not supported in no-MCP mode');
  },
  async sendMessage() {
    throw new Error('q1-fake-agent-runner: send_message not supported in no-MCP mode');
  },
  async listAgents() {
    return [];
  },
  async disconnect() {
    /* no-op */
  },
};

const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const BOX_TOP_LEFT = '╔';
const BOX_HORIZONTAL = '═';

const script = {
  actions: [
    { type: 'log', message: `${CYAN}BF208_RENDER_ANSI${RESET}` },
    { type: 'log', message: `${BOX_TOP_LEFT}${BOX_HORIZONTAL}${BOX_HORIZONTAL} BOX TOP` },
    { type: 'log', message: 'BF208_RENDER_PASS' },
    { type: 'log', message: 'BF208_RENDER_DONE' },
    { type: 'delay', ms: 30000 },
    { type: 'exit', code: 0 },
  ],
};

const env = {
  terminalId: process.env.VOICETREE_TERMINAL_ID || 'wi-Q1',
  taskNodePath: '',
  canReceiveWaitNotifications: false,
};

const abortController = new AbortController();
process.on('SIGTERM', () => abortController.abort());
process.on('SIGINT', () => abortController.abort());

await executeScript(script, noopMcpClient, env, abortController);
