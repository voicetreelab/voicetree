import { fetchProfileJson } from '../data/manifest.js'
import { flattenCpuProfile, topK } from '../data/profile-reducer.mjs'

function clear(slot) {
  slot.replaceChildren()
}

function mountMessage(slot, message) {
  clear(slot)
  const note = document.createElement('p')
  note.className = 'panel-note'
  note.textContent = message
  slot.append(note)
}

function renderRows(profile, includePseudo) {
  return topK(flattenCpuProfile(profile, { includePseudo }), 20)
}

function mountTable(body, rows) {
  body.replaceChildren()
  if (rows.length === 0) {
    const row = document.createElement('tr')
    const cell = document.createElement('td')
    cell.colSpan = 3
    cell.textContent = 'No CPU samples captured.'
    row.append(cell)
    body.append(row)
    return
  }

  rows.forEach(([key, weight], index) => {
    const row = document.createElement('tr')
    const rank = document.createElement('td')
    const func = document.createElement('td')
    const time = document.createElement('td')
    rank.textContent = String(index + 1)
    func.textContent = key
    time.textContent = (weight / 1000).toFixed(3)
    row.append(rank, func, time)
    body.append(row)
  })
}

function mountTopK(slot, svc, profile) {
  clear(slot)

  const section = document.createElement('section')
  section.className = 'topk-panel'

  const header = document.createElement('div')
  header.className = 'panel-header-row'
  const title = document.createElement('h4')
  title.textContent = `${svc} · top CPU self-time`

  const label = document.createElement('label')
  label.className = 'toggle-row'
  const checkbox = document.createElement('input')
  checkbox.type = 'checkbox'
  const text = document.createElement('span')
  text.textContent = 'Include V8 pseudo-frames'
  label.append(checkbox, text)
  header.append(title, label)

  const table = document.createElement('table')
  table.className = 'topk-table'
  table.innerHTML = `<thead>
    <tr><th>rank</th><th>function key</th><th>self-time (ms)</th></tr>
  </thead>`
  const body = document.createElement('tbody')
  table.append(body)

  const sync = () => mountTable(body, renderRows(profile, checkbox.checked))
  checkbox.addEventListener('change', sync)
  sync()

  section.append(header, table)
  slot.append(section)
}

export async function render(slot, svc, cpuprofileUrl) {
  mountMessage(slot, 'Loading CPU profile...')
  const profile = await fetchProfileJson(cpuprofileUrl)
  mountTopK(slot, svc, profile)
}
