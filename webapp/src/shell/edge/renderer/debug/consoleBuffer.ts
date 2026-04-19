// Pure ring buffer + shell hooks for renderer debug capture.
// Installed pre-React so startup errors (blank-UI, thrown useEffects) are never lost.

type Level = 'log' | 'info' | 'warn' | 'error' | 'debug'

export type ConsoleMsg = { level: Level; args: unknown[]; atIso: string }
export type ExceptionMsg = { message: string; stack?: string; atIso: string }

interface RingBuffer<T> {
  push(item: T): void
  tail(n: number): readonly T[]
  all(): readonly T[]
}

export interface DebugRingBuffer {
  hook(target: Console): void
  pushException(msg: ExceptionMsg): void
  tail(n: number): readonly ConsoleMsg[]
  exceptions(): readonly ExceptionMsg[]
}

// Pure: fixed-size circular buffer
function makeRing<T>(maxSize: number): RingBuffer<T> {
  const buf: T[] = []
  return {
    push(item: T): void {
      if (buf.length >= maxSize) buf.shift()
      buf.push(item)
    },
    tail(n: number): readonly T[] { return buf.slice(-n) },
    all(): readonly T[] { return buf.slice() },
  }
}

const MAX_MSGS: number = 500
const consoleBuf: RingBuffer<ConsoleMsg> = makeRing<ConsoleMsg>(MAX_MSGS)
const exceptionBuf: RingBuffer<ExceptionMsg> = makeRing<ExceptionMsg>(MAX_MSGS)

// Shell: patches console.* to mirror into consoleBuf while preserving original behaviour
function hookConsole(target: Console): void {
  const levels: Level[] = ['log', 'info', 'warn', 'error', 'debug']
  for (const level of levels) {
    const orig: (...a: unknown[]) => void = (target[level] as (...a: unknown[]) => void).bind(target)
    ;(target as unknown as Record<string, (...a: unknown[]) => void>)[level] = (...args) => {
      consoleBuf.push({ level, args, atIso: new Date().toISOString() })
      orig(...args)
    }
  }
}

export const ringBuffer: DebugRingBuffer = {
  hook: hookConsole,
  pushException(msg: ExceptionMsg): void { exceptionBuf.push(msg) },
  tail(n: number): readonly ConsoleMsg[] { return consoleBuf.tail(n) },
  exceptions(): readonly ExceptionMsg[] { return exceptionBuf.all() },
}
