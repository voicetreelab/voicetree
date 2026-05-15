import type { Graph } from '@vt/graph-model/graph'
import { GraphStateSchema } from '@vt/graph-db-server/contract'

export function composeGraphResponse(graph: Graph): unknown {
  return GraphStateSchema.parse(graph)
}

export function classifyFindFileRequest(input: {
  readonly name: string | undefined
  readonly searchPath: string | null | undefined
}):
  | { readonly kind: 'ok'; readonly name: string; readonly searchPath: string }
  | {
      readonly kind: 'error'
      readonly message: 'Missing required query parameter: name'
      readonly code: 'MISSING_NAME'
      readonly status?: undefined
    }
  | {
      readonly kind: 'error'
      readonly message: 'No vault is currently open'
      readonly code: 'NO_VAULT'
      readonly status: 503
    } {
  if (!input.name) {
    return {
      kind: 'error',
      message: 'Missing required query parameter: name',
      code: 'MISSING_NAME',
    }
  }

  if (!input.searchPath) {
    return {
      kind: 'error',
      message: 'No vault is currently open',
      code: 'NO_VAULT',
      status: 503,
    }
  }

  return { kind: 'ok', name: input.name, searchPath: input.searchPath }
}

export function composeFindFileResponse(matches: readonly string[]): {
  readonly matches: readonly string[]
} {
  return { matches }
}

export function composeAppliedResponse(applied: boolean): { readonly applied: boolean } {
  return { applied }
}
