const V8_PSEUDO_FRAMES = new Set(['(idle)', '(program)', '(garbage collector)'])

const toCallFrame = (node) => node?.callFrame ?? {}

const keyOf = (callFrame) =>
  `${callFrame.functionName || '(anonymous)'}@${callFrame.url ?? ''}:${callFrame.lineNumber ?? 0}`

export function flattenCpuProfile(profile, { includePseudo = false } = {}) {
  const nodes = Array.isArray(profile?.nodes) ? profile.nodes : []
  const samples = Array.isArray(profile?.samples) ? profile.samples : []
  const timeDeltas = Array.isArray(profile?.timeDeltas) ? profile.timeDeltas : []
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const weights = new Map()

  for (let i = 0; i < samples.length; i++) {
    const node = nodeById.get(samples[i])
    if (!node) continue

    const callFrame = toCallFrame(node)
    const functionName = callFrame.functionName || '(anonymous)'
    if (!includePseudo && V8_PSEUDO_FRAMES.has(functionName)) continue

    const weight = timeDeltas[i] ?? 0
    const key = keyOf(callFrame)
    weights.set(key, (weights.get(key) ?? 0) + weight)
  }

  return weights
}

export function topK(weights, k = 20) {
  return [...weights.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, k)
}
