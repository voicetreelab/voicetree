export function getBrowserSources() {
  return {
    POST_CLICK_WAIT_MS: 150,

    COLLECT_BUTTONS_SOURCE: String.raw`
({ rootSelector, allowedLabels }) => {
  const normalize = label => label.replace(/\s+/g, ' ').trim().toLowerCase()
  const safeNum = value => (typeof value === 'number' && isFinite(value) ? value : 0)
  const boxFromRect = rect => ({
    x: safeNum(rect.left),
    y: safeNum(rect.top),
    w: safeNum(rect.width),
    h: safeNum(rect.height),
  })
  const labelOf = el => {
    const aria = el.getAttribute('aria-label')
    if (aria && aria.trim()) return aria.trim()
    const title = el.getAttribute('title')
    if (title && title.trim()) return title.trim()
    return (el.textContent ?? '').replace(/\s+/g, ' ').trim()
  }
  const isDisabled = el => {
    if (el.getAttribute('aria-disabled') === 'true') return true
    return 'disabled' in el ? Boolean(el.disabled) : false
  }
  const selectorOf = el => {
    if (el.id) return '#' + CSS.escape(el.id)
    const parts = []
    let current = el
    while (current && current !== document.body) {
      let part = current.tagName.toLowerCase()
      const floatingWindowId = current.getAttribute('data-floating-window-id')
      if (floatingWindowId) {
        part += '[data-floating-window-id="' + CSS.escape(floatingWindowId) + '"]'
        parts.unshift(part)
        break
      }
      if (current instanceof HTMLElement && current.classList.length > 0) {
        part += '.' + [...current.classList].slice(0, 3).map(name => CSS.escape(name)).join('.')
      }
      const parent = current.parentElement
      if (parent) {
        const currentTag = current.tagName
        const siblings = [...parent.children].filter(sibling => sibling.tagName === currentTag)
        if (siblings.length > 1) {
          part += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')'
        }
      }
      parts.unshift(part)
      current = parent
    }
    return parts.join(' > ')
  }

  const allowed = new Set(allowedLabels)
  const allowAll = allowed.size === 0
  let root = null
  try {
    root = document.querySelector(rootSelector)
  } catch {
    root = null
  }
  if (!root) return []

  return Array.from(root.querySelectorAll('button, a, [role="button"], [role="link"], [role="menuitem"]'))
    .map(el => {
      const label = labelOf(el)
      return {
        label,
        normalized: normalize(label),
        selector: selectorOf(el),
        bbox: boxFromRect(el.getBoundingClientRect()),
        enabled: !isDisabled(el),
      }
    })
    .filter(button => button.label && button.selector && (allowAll || allowed.has(button.normalized)))
    .map(({ label, selector, bbox, enabled }) => ({ label, selector, bbox, enabled }))
}
`,

    TAKE_RENDERER_SNAPSHOT_SOURCE: String.raw`
(id) => {
  const safeNum = value => (typeof value === 'number' && isFinite(value) ? value : 0)
  const debugWindow = window
  const editorWindowId = id + '-editor'
  const floatingWindows = Array.from(document.querySelectorAll('[data-floating-window-id]'))
  const editorWindow = floatingWindows.find(
    el => el.getAttribute('data-floating-window-id') === editorWindowId,
  )

  const registryRaw = typeof debugWindow.__vtDebug__?.buttons === 'function'
    ? debugWindow.__vtDebug__.buttons()
    : []
  const registry = Array.isArray(registryRaw)
    ? registryRaw.map(entry => {
      const rec = entry ?? {}
      const selector = typeof rec.selector === 'string' ? rec.selector : ''
      let element = null
      if (selector) {
        try {
          element = document.querySelector(selector)
        } catch {
          element = null
        }
      }
      const rect = element instanceof HTMLElement ? element.getBoundingClientRect() : null
      const disabled = element && 'disabled' in element ? Boolean(element.disabled) : false
      return {
        nodeId: String(rec.nodeId ?? ''),
        label: String(rec.label ?? ''),
        selector,
        bbox: rect
          ? {
              x: safeNum(rect.left),
              y: safeNum(rect.top),
              w: safeNum(rect.width),
              h: safeNum(rect.height),
            }
          : { x: 0, y: 0, w: 0, h: 0 },
        enabled: element ? !disabled && element.getAttribute('aria-disabled') !== 'true' : true,
      }
    })
    : []

  return {
    rootWindowId: editorWindow ? editorWindowId : null,
    registry,
  }
}
`,

    BEGIN_CAPTURE_SOURCE: String.raw`
({ selector, markKey }) => {
  const target = document.querySelector(selector)
  if (!(target instanceof HTMLElement)) {
    return { ok: false, error: 'selector not found: ' + selector }
  }

  const globalStore = window
  const previous = globalStore[markKey]
  if (previous && typeof previous.cleanup === 'function') {
    try {
      previous.cleanup()
    } catch {}
  }

  const eventTypes = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'input', 'change', 'focusin', 'focusout']
  const events = []
  const handler = event => {
    const origin = event.target
    if (origin === target || (origin instanceof Node && target.contains(origin))) {
      events.push(event.type)
    }
  }

  for (const type of eventTypes) {
    document.addEventListener(type, handler)
  }

  globalStore[markKey] = {
    beforeMs: Date.now(),
    events,
    cleanup: () => {
      for (const type of eventTypes) {
        document.removeEventListener(type, handler)
      }
    },
  }

  return { ok: true }
}
`,

    END_CAPTURE_SOURCE: String.raw`
(markKey) => {
  const globalStore = window
  const store = globalStore[markKey]
  const beforeMs = typeof store?.beforeMs === 'number' ? store.beforeMs : 0

  const serialize = (value, seen = new Set()) => {
    if (value === null) return null
    const type = typeof value
    if (type === 'string' || type === 'number' || type === 'boolean') return value
    if (type === 'undefined' || type === 'bigint' || type === 'symbol' || type === 'function') {
      return String(value)
    }
    if (type !== 'object') return String(value)
    if (seen.has(value)) return '[Circular]'
    seen.add(value)

    if (Array.isArray(value)) {
      return value.map(item => serialize(item, seen))
    }
    if (value && value.nodeType === 1 && typeof value.tagName === 'string') {
      const id = typeof value.id === 'string' && value.id ? '#' + value.id : ''
      return '<' + value.tagName.toLowerCase() + id + '>'
    }

    const proto = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null) {
      const name = value?.constructor?.name
      return name ? '[' + name + ']' : String(value)
    }

    const out = {}
    for (const [key, entry] of Object.entries(value)) {
      out[key] = serialize(entry, seen)
    }
    return out
  }

  const consoleRaw = typeof globalStore.__vtDebug__?.console === 'function'
    ? globalStore.__vtDebug__.console()
    : []
  const consoleAfter = Array.isArray(consoleRaw)
    ? consoleRaw
        .filter(entry => {
          const atIso = typeof entry?.atIso === 'string' ? entry.atIso : ''
          const atMs = Date.parse(atIso)
          return Number.isNaN(atMs) || atMs >= beforeMs
        })
        .map(entry => ({
          level: entry?.level === 'log' || entry?.level === 'info' || entry?.level === 'warn' || entry?.level === 'error' || entry?.level === 'debug'
            ? entry.level
            : 'log',
          args: Array.isArray(entry?.args) ? entry.args.map(arg => serialize(arg)) : [],
          atIso: typeof entry?.atIso === 'string' ? entry.atIso : new Date().toISOString(),
        }))
    : []

  const dispatchedEvents = Array.isArray(store?.events) ? [...store.events] : []

  if (store && typeof store.cleanup === 'function') {
    try {
      store.cleanup()
    } catch {}
  }
  try {
    delete globalStore[markKey]
  } catch {}

  return { dispatchedEvents, consoleAfter }
}
`,
  }
}
