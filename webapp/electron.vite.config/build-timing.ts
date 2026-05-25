import type { Plugin } from 'vite'

// Per-pipeline build timing. Pair plugins: a `pre`-enforced one starts a per-id
// timer in transform(); a `post`-enforced one stops it. Sum of (post-pre) per id
// approximates the time other plugins spent transforming that file in this
// pipeline. Bucket by node_modules package to surface the heaviest deps.
// Wall-clock per pipeline comes from buildStart/buildEnd. Opt-in via
// VT_BUILD_TIMING=1 so normal builds stay quiet. Stderr-only output.
type TimingState = { pipelineStart: bigint; perId: Map<string, bigint>; perPkg: Map<string, bigint> }
type TimedHook =
  | 'resolveId'
  | 'load'
  | 'transform'
  | 'generateBundle'
  | 'renderChunk'
  | 'writeBundle'
  | 'closeBundle'
type HookTiming = { total: bigint; count: number; details: Map<string, bigint> }
type HookPhase = { firstStart: bigint; lastEnd: bigint; total: bigint; count: number }
type HookFunction = (this: unknown, ...args: unknown[]) => unknown
type BuildMark = { label: string; at: bigint }

const packageOf = (id: string): string => {
  const idx = id.lastIndexOf('/node_modules/')
  if (idx < 0) return '(app)'
  const tail = id.slice(idx + '/node_modules/'.length)
  const parts = tail.split('/')
  return parts[0].startsWith('@') && parts.length > 1 ? `${parts[0]}/${parts[1]}` : parts[0]
}

const fmtMs = (ns: bigint) => `${(Number(ns) / 1e6).toFixed(0)}ms`

const addHookTiming = (
  timings: Map<string, HookTiming>,
  phases: Map<TimedHook, HookPhase>,
  hook: TimedHook,
  pluginName: string,
  detail: string | undefined,
  start: bigint,
  end: bigint,
  elapsed: bigint
) => {
  const phase = phases.get(hook) ?? { firstStart: start, lastEnd: end, total: 0n, count: 0 }
  if (start < phase.firstStart) phase.firstStart = start
  if (end > phase.lastEnd) phase.lastEnd = end
  phase.total += elapsed
  phase.count += 1
  phases.set(hook, phase)

  const key = `${hook}:${pluginName}`
  const timing = timings.get(key) ?? { total: 0n, count: 0, details: new Map<string, bigint>() }
  timing.total += elapsed
  timing.count += 1
  if (detail) {
    timing.details.set(detail, (timing.details.get(detail) ?? 0n) + elapsed)
  }
  timings.set(key, timing)
}

const hookDetail = (hook: TimedHook, args: unknown[]): string | undefined => {
  const first = args[0]
  if ((hook === 'resolveId' || hook === 'load' || hook === 'transform') && typeof first === 'string') {
    if (hook === 'transform' && typeof args[1] === 'string') return args[1]
    return first
  }
  if (hook === 'renderChunk') {
    const chunk = args[1] as { fileName?: string; name?: string } | undefined
    return chunk?.fileName ?? chunk?.name
  }
  return undefined
}

const summarizeDetails = (details: Map<string, bigint>) =>
  [...details.entries()]
    .sort((a, b) => Number(b[1] - a[1]))
    .slice(0, 5)
    .map(([detail, ns]) => `      ${detail.slice(0, 90).padEnd(90)} ${fmtMs(ns)}`)
    .join('\n')

const hookHandler = (hookValue: unknown): HookFunction | undefined => {
  if (typeof hookValue === 'function') return hookValue as HookFunction
  if (hookValue && typeof hookValue === 'object' && typeof (hookValue as { handler?: unknown }).handler === 'function') {
    return (hookValue as { handler: HookFunction }).handler
  }
  return undefined
}

const withHookHandler = (hookValue: unknown, handler: HookFunction) => {
  if (typeof hookValue === 'function') return handler
  return { ...(hookValue as object), handler }
}

export const rollupHookTimingPlugin = (label: string): Plugin => {
  const enabled = process.env.VT_BUILD_TIMING === '1'
  const hooks: TimedHook[] = ['resolveId', 'load', 'transform', 'generateBundle', 'renderChunk', 'writeBundle', 'closeBundle']
  const timings = new Map<string, HookTiming>()
  const phases = new Map<TimedHook, HookPhase>()
  const marks: BuildMark[] = []
  const mark = (markLabel: string) => {
    if (enabled) marks.push({ label: markLabel, at: process.hrtime.bigint() })
  }
  return {
    name: `vt-rollup-hook-timing-${label}`,
    enforce: 'pre',
    buildStart() {
      timings.clear()
      phases.clear()
      marks.length = 0
      mark('buildStart')
    },
    renderStart() {
      mark('renderStart')
    },
    generateBundle() {
      mark('generateBundle')
    },
    writeBundle() {
      mark('writeBundle')
    },
    configResolved(config) {
      if (!enabled) return
      for (const plugin of config.plugins) {
        if (plugin.name.startsWith('vt-rollup-hook-timing-')) continue
        for (const hook of hooks) {
          const originalValue = plugin[hook]
          const originalHandler = hookHandler(originalValue)
          if (!originalHandler) continue
          plugin[hook] = withHookHandler(originalValue, function timedRollupHook(this: unknown, ...args: unknown[]) {
            const start = process.hrtime.bigint()
            const record = () => {
              const end = process.hrtime.bigint()
              addHookTiming(timings, phases, hook, plugin.name, hookDetail(hook, args), start, end, end - start)
            }
            try {
              const result = originalHandler.apply(this, args)
              if (result && typeof (result as Promise<unknown>).then === 'function') {
                return (result as Promise<unknown>).finally(record)
              }
              record()
              return result
            } catch (error) {
              record()
              throw error
            }
          }) as never
        }
      }
    },
    closeBundle() {
      mark('closeBundle')
      if (!enabled || timings.size === 0) return
      const markLines = marks
        .map((current, idx) => {
          const previous = marks[idx - 1]
          const sinceStart = current.at - marks[0].at
          const sincePrevious = previous ? current.at - previous.at : 0n
          return `    ${current.label.padEnd(18)} +${fmtMs(sincePrevious).padStart(8)} since-start=${fmtMs(sinceStart).padStart(8)}`
        })
        .join('\n')
      const phaseLines = [...phases.entries()]
        .sort((a, b) => Number((b[1].lastEnd - b[1].firstStart) - (a[1].lastEnd - a[1].firstStart)))
        .map(([hook, phase]) => {
          const span = phase.lastEnd - phase.firstStart
          return `    ${hook.padEnd(16)} span=${fmtMs(span).padStart(8)} cumulative=${fmtMs(phase.total).padStart(8)} ${String(phase.count).padStart(6)} calls`
        })
        .join('\n')
      const lines = [...timings.entries()]
        .sort((a, b) => Number(b[1].total - a[1].total))
        .slice(0, 40)
        .map(([key, timing]) => {
          const details = summarizeDetails(timing.details)
          return `    ${key.padEnd(62)} ${fmtMs(timing.total).padStart(8)} ${String(timing.count).padStart(5)} calls${
            details ? `\n${details}` : ''
          }`
        })
        .join('\n')
      process.stderr.write(
        `\n[vt-build-timing] ${label} rollup build marks\n${markLines}\n` +
        `\n[vt-build-timing] ${label} rollup hook phases\n${phaseLines}\n` +
          `\n[vt-build-timing] ${label} rollup hooks (top cumulative plugin hook time)\n${lines}\n`
      )
    }
  }
}

export const buildTimingPlugins = (label: string) => {
  const enabled = process.env.VT_BUILD_TIMING === '1'
  const state: TimingState = { pipelineStart: 0n, perId: new Map(), perPkg: new Map() }
  const pre = {
    name: `vt-build-timing-${label}-pre`,
    enforce: 'pre' as const,
    buildStart() {
      if (!enabled) return
      state.pipelineStart = process.hrtime.bigint()
      state.perId.clear()
      state.perPkg.clear()
    },
    transform(_code: string, id: string) {
      if (!enabled) return null
      state.perId.set(id, process.hrtime.bigint())
      return null
    },
  }
  const post = {
    name: `vt-build-timing-${label}-post`,
    enforce: 'post' as const,
    transform(_code: string, id: string) {
      if (!enabled) return null
      const start = state.perId.get(id)
      if (start === undefined) return null
      const dt = process.hrtime.bigint() - start
      state.perPkg.set(packageOf(id), (state.perPkg.get(packageOf(id)) ?? 0n) + dt)
      return null
    },
    buildEnd() {
      if (!enabled) return
      const total = process.hrtime.bigint() - state.pipelineStart
      const top = [...state.perPkg.entries()]
        .sort((a, b) => Number(b[1] - a[1]))
        .slice(0, 10)
        .map(([pkg, ns]) => `    ${pkg.padEnd(40)} ${fmtMs(ns)}`)
        .join('\n')
      process.stderr.write(`\n[vt-build-timing] ${label} pipeline: ${fmtMs(total)}\n${top}\n`)
    },
  }
  return [pre, post]
}
