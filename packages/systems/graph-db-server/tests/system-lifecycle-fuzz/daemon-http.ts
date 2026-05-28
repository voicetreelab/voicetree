import { stat } from 'node:fs/promises'

export interface FuzzGraphNode {
  absoluteFilePathIsID: string
  outgoingEdges: Array<{ targetId: string }>
  contentWithoutYamlOrLinks: string
}

export interface FuzzGraph {
  nodes: Record<string, FuzzGraphNode>
}

export async function fetchJson(
  url: string,
  init?: RequestInit,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, init)
  const body = await res.json()
  return { status: res.status, body }
}

export async function fetchDaemonGraph(baseUrl: string): Promise<FuzzGraph> {
  const { body } = await fetchJson(`${baseUrl}/graph`)
  return body as FuzzGraph
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}
