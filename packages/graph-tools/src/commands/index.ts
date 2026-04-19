import type { Response } from '../debug/Response'

export type Handler = (argv: string[]) => Promise<Response<unknown>>

export const commandRegistry: Map<string, Handler> = new Map()

export function registerCommand(name: string, handler: Handler): void {
  commandRegistry.set(name, handler)
}
