import { stat } from 'node:fs/promises'

import type { GraphNode } from './types.ts'

export async function fetchJson(
  url: string,
  init?: RequestInit,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, init)
  const body = await res.json()
  return { status: res.status, body }
}

export async function getGraph(baseUrl: string): Promise<{ nodes: Record<string, GraphNode> }> {
  const { body } = await fetchJson(`${baseUrl}/graph`)
  return body as { nodes: Record<string, GraphNode> }
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

export async function waitFor(
  read: () => Promise<boolean>,
  timeoutMs = 8000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await read()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('waitFor: condition not met before timeout')
}
