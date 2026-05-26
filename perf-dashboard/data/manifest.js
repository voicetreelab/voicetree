export async function fetchRuns() {
  const res = await fetch('/api/runs')
  if (!res.ok) throw new Error(`Failed to load runs: ${res.status}`)
  return res.json()
}

export async function fetchManifest(ts) {
  const res = await fetch(`/api/runs/${encodeURIComponent(ts)}/manifest`)
  if (!res.ok) throw new Error(`Failed to load manifest: ${res.status}`)
  return res.json()
}

export async function fetchNdjson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to load NDJSON: ${res.status}`)
  const text = await res.text()
  return text.split('\n').map(line => line.trim()).filter(Boolean).map(line => JSON.parse(line))
}

export async function fetchProfileJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to load profile: ${res.status}`)
  return res.json()
}
