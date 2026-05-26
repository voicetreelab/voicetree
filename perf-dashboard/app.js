import { fetchManifest, fetchRuns } from './data/manifest.js'

const app = document.getElementById('app')

function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function selectedRunFromHash() {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''))
  return params.get('run')
}

function runHref(ts) {
  return `#run=${encodeURIComponent(ts)}`
}

function renderSidebar(runs, selectedTs) {
  const items = runs.length
    ? runs.map(run => {
      const selected = run.ts === selectedTs ? ' aria-current="page"' : ''
      return `<a class="run-link" href="${runHref(run.ts)}"${selected}>
  <span class="run-ts">${esc(run.ts)}</span>
  <span class="run-size">${Math.ceil(run.sizeBytes / 1024)} KiB</span>
</a>`
    }).join('')
    : '<p class="empty-note">No stable-perf runs found.</p>'

  return `<aside class="sidebar" aria-label="Stable perf runs">
  <div class="sidebar-head">
    <div class="brand-mark" aria-hidden="true"></div>
    <div>
      <h1>Stable <em>Perf</em></h1>
      <p>VoiceTree · Run Dashboard</p>
    </div>
  </div>
  <nav class="run-list">${items}</nav>
</aside>`
}

function manifestFileUrl(ts, relPath) {
  return `/api/runs/${encodeURIComponent(ts)}/file?path=${encodeURIComponent(relPath)}`
}

function renderRunDetails(ts, manifest) {
  const metricEntries = Object.entries(manifest.metrics)
  const profileEntries = Object.entries(manifest.profiles)
    .flatMap(([svc, profile]) => Object.entries(profile).filter(([, rel]) => typeof rel === 'string').map(([kind, rel]) => [svc, kind, rel]))

  const serviceCards = manifest.services.map(svc => `<section class="slot" data-slot="service-${esc(svc)}">
  <h3>${esc(svc)}</h3>
  <div class="slot-grid">
    <div class="panel-slot" data-slot="metrics-${esc(svc)}">
      <span>Metrics</span>
      <code>${esc(manifest.metrics[svc] ?? 'not captured')}</code>
    </div>
    <div class="panel-slot" data-slot="profiles-${esc(svc)}">
      <span>CPU Profile</span>
      <code>${esc(manifest.profiles[svc]?.cpu ?? 'not captured')}</code>
    </div>
  </div>
</section>`).join('')

  return `<main class="content" aria-label="Run details">
  <header class="run-header">
    <div>
      <p class="eyebrow">Selected run</p>
      <h2>${esc(ts)}</h2>
    </div>
    <div class="run-tally">
      <span>${manifest.services.length} services</span>
      <span>${metricEntries.length} metric files</span>
      <span>${profileEntries.length} profiles</span>
    </div>
  </header>
  <section class="slot" data-slot="run-overview">
    <h3>Overview</h3>
    <div class="slot-grid">
      <div class="panel-slot" data-slot="summary">
        <span>Summary</span>
        <code>${esc(manifest.summary ?? 'not captured')}</code>
      </div>
      <div class="panel-slot" data-slot="services">
        <span>Services</span>
        <code>${esc(manifest.services.join(', ') || 'none')}</code>
      </div>
    </div>
  </section>
  <section class="slot" data-slot="artifacts">
    <h3>Artifacts</h3>
    <div class="artifact-list">
      ${metricEntries.map(([svc, rel]) => `<a href="${manifestFileUrl(ts, rel)}">${esc(svc)} metrics</a>`).join('')}
      ${profileEntries.map(([svc, kind, rel]) => `<a href="${manifestFileUrl(ts, rel)}">${esc(svc)} ${esc(kind)}</a>`).join('')}
    </div>
  </section>
  ${serviceCards || '<section class="slot"><h3>No service artifacts found</h3></section>'}
</main>`
}

function renderEmptyState() {
  return `<main class="content" aria-label="Run details">
  <section class="empty-state">
    <p class="eyebrow">Run picker</p>
    <h2>Select a stable-perf run</h2>
  </section>
</main>`
}

function renderError(message) {
  return `<main class="content" aria-label="Run details">
  <section class="empty-state is-error">
    <p class="eyebrow">Dashboard error</p>
    <h2>${esc(message)}</h2>
  </section>
</main>`
}

async function load() {
  const selectedTs = selectedRunFromHash()
  app.innerHTML = '<div class="state-loading"><div class="spinner" aria-hidden="true"></div><p>Loading runs...</p></div>'

  try {
    const runs = await fetchRuns()
    const ts = selectedTs ?? runs[0]?.ts ?? null
    const manifest = ts ? await fetchManifest(ts) : null
    app.innerHTML = `<div class="layout">${renderSidebar(runs, ts)}${manifest ? renderRunDetails(ts, manifest) : renderEmptyState()}</div>`
  } catch (err) {
    app.innerHTML = `<div class="layout"><aside class="sidebar"></aside>${renderError(err?.message ?? err)}</div>`
  }
}

window.addEventListener('hashchange', load)
load()
