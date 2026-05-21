import { esc, relTime } from './format.js'

function commitRow(c) {
  const hasBody = c.body && c.body.trim().length > 0
  const summary = `<summary class="git-commit-summary" title="${esc((c.subject ?? '') + (hasBody ? '\n\n' + c.body : ''))}">
    <code class="git-commit-hash">${esc(c.hash)}</code>
    <span class="git-commit-subject">${esc(c.subject)}</span>
    <span class="git-commit-meta">${esc(c.author)} · <time title="${esc(c.iso)}">${relTime(c.iso)}</time></span>
    ${hasBody ? '<span class="git-commit-expand" aria-hidden="true">▾</span>' : '<span class="git-commit-expand is-empty" aria-hidden="true"></span>'}
  </summary>`
  const bodyHtml = hasBody
    ? `<pre class="git-commit-body">${esc(c.body)}</pre>`
    : ''
  return `<li><details class="git-commit" data-hash="${esc(c.hash)}">${summary}${bodyHtml}</details></li>`
}

function dirtyRow(f) {
  const adds = f.adds > 0 ? `<span class="git-adds">+${f.adds.toLocaleString()}</span>` : ''
  const dels = f.dels > 0 ? `<span class="git-dels">−${f.dels.toLocaleString()}</span>` : ''
  const untracked = f.untracked > 0 ? `<span class="git-untracked" title="untracked files">?${f.untracked}</span>` : ''
  const fileLabel = f.files === 1 ? '1 file' : `${f.files} files`
  return `<li class="git-folder">
    <span class="git-folder-name">${esc(f.folder)}</span>
    <span class="git-folder-files">${fileLabel}</span>
    <span class="git-folder-diff">${adds}${dels}${untracked}</span>
  </li>`
}

function upstreamChip(u) {
  if (!u?.hasUpstream) return `<span class="git-upstream is-none" title="no upstream tracked">no upstream</span>`
  if (u.ahead === 0 && u.behind === 0) return `<span class="git-upstream is-clean">in sync</span>`
  const parts = []
  if (u.ahead) parts.push(`<span class="git-ahead">↑${u.ahead}</span>`)
  if (u.behind) parts.push(`<span class="git-behind">↓${u.behind}</span>`)
  return `<span class="git-upstream">${parts.join(' ')}</span>`
}

function totalsChip(t) {
  const adds = t.adds > 0 ? `<span class="git-adds">+${t.adds.toLocaleString()}</span>` : ''
  const dels = t.dels > 0 ? `<span class="git-dels">−${t.dels.toLocaleString()}</span>` : ''
  const untracked = t.untracked > 0 ? `<span class="git-untracked">?${t.untracked} untracked</span>` : ''
  if (t.files === 0) return `<span class="git-clean">working tree clean</span>`
  const fileLabel = t.files === 1 ? '1 file dirty' : `${t.files} files dirty`
  return `<span class="git-totals">${fileLabel} · ${adds}${dels}${untracked}</span>`
}

export function renderGitTally(data) {
  if (!data) return `<span class="git-error">unavailable</span>`
  return `<span class="git-branch">${esc(data.branch)}</span>
    ${upstreamChip(data.upstream)}
    ${totalsChip(data.totals)}`
}

export function renderGitFolders(data) {
  if (!data) return `<p class="git-empty">unavailable</p>`
  return data.dirtyFolders?.length
    ? `<ol class="git-folders">${data.dirtyFolders.map(dirtyRow).join('')}</ol>`
    : `<p class="git-empty">working tree clean</p>`
}

export function renderGitCommits(data) {
  if (!data) return `<p class="git-empty">unavailable</p>`
  return data.commits?.length
    ? `<ol class="git-commits">${data.commits.map(commitRow).join('')}</ol>`
    : `<p class="git-empty">no commits</p>`
}

export function renderGitSection(data) {
  const errCls = data ? '' : 'is-error'
  return `<section class="git-section ${errCls}" data-section="git">
    <div class="category-header">
      <span class="category-name">Git Status</span>
      <span class="category-rule"></span>
      <span class="category-tally" data-git-zone="tally">${renderGitTally(data)}</span>
    </div>
    <div class="git-body">
      <div class="git-col">
        <h3 class="git-col-name">Dirty folders</h3>
        <div data-git-zone="folders">${renderGitFolders(data)}</div>
      </div>
      <div class="git-col">
        <h3 class="git-col-name">Recent commits</h3>
        <div data-git-zone="commits">${renderGitCommits(data)}</div>
      </div>
    </div>
  </section>`
}
