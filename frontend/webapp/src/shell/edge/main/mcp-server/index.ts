#!/usr/bin/env node
/**
 * MCP Server Entry Point (Standalone Mode)
 *
 * This file is for standalone testing. In production, the MCP server
 * is started by the Electron main process to share graph state.
 *
 * Standalone: npx tsx src/shell/edge/main/mcp-server/index.ts
 *
 * For Claude Code, configure in settings to connect via HTTP:
 * URL: http://localhost:3001/mcp
 */

import {startMcpServer, getMcpPort} from './mcp-server'

//console.log(`[MCP] Starting standalone MCP server on port ${getMcpPort()}...`)

startMcpServer().catch((error: unknown) => {
    console.error('Failed to start MCP server:', error)
    process.exit(1)
})
