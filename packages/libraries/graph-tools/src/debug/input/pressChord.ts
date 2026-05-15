type MinimalKeyboardPage = {
  keyboard: {
    press(chord: string): Promise<void>
  }
  evaluate<T, Arg>(pageFunction: (arg: Arg) => T | Promise<T>, arg: Arg): Promise<T>
}

function isModifierChord(normalizedChord: string): boolean {
  return normalizedChord.includes('Meta+')
    || normalizedChord.includes('Control+')
    || normalizedChord.includes('Alt+')
}

type HotkeyEventPayload = {
  key: string
  code: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

function buildHotkeyPayload(normalizedChord: string): HotkeyEventPayload {
  const parts: string[] = normalizedChord.split('+').filter(Boolean)
  const keyPart: string = parts.at(-1) ?? ''
  const lowerKey: string = keyPart.toLowerCase()

  const code: string =
    lowerKey.length === 1 && /^[a-z0-9]$/.test(lowerKey)
      ? (/[a-z]/.test(lowerKey) ? `Key${lowerKey.toUpperCase()}` : `Digit${lowerKey}`)
      : keyPart

  return {
    key: lowerKey,
    code,
    metaKey: parts.includes('Meta'),
    ctrlKey: parts.includes('Control'),
    altKey: parts.includes('Alt'),
    shiftKey: parts.includes('Shift'),
  }
}

async function tryPressViaHotkeyManager(
  page: MinimalKeyboardPage,
  normalizedChord: string,
): Promise<boolean> {
  if (!isModifierChord(normalizedChord)) {
    return false
  }

  const payload: HotkeyEventPayload = buildHotkeyPayload(normalizedChord)
  return page.evaluate(
    ({
      key,
      code,
      metaKey,
      ctrlKey,
      altKey,
      shiftKey,
    }: HotkeyEventPayload): boolean => {
      const hotkeyManager: {
        keyDownHandler?: (e: KeyboardEvent) => void
        keyUpHandler?: (e: KeyboardEvent) => void
      } | undefined =
        (window as unknown as {
          voiceTreeGraphView?: {
            hotkeyManager?: {
              keyDownHandler?: (e: KeyboardEvent) => void
              keyUpHandler?: (e: KeyboardEvent) => void
            }
          }
        }).voiceTreeGraphView?.hotkeyManager

      if (
        typeof hotkeyManager?.keyDownHandler !== 'function'
        || typeof hotkeyManager?.keyUpHandler !== 'function'
      ) {
        return false
      }

      const init: KeyboardEventInit = {
        key,
        code,
        metaKey,
        ctrlKey,
        altKey,
        shiftKey,
        bubbles: true,
        cancelable: true,
      }

      const keyDown: KeyboardEvent = new KeyboardEvent('keydown', init)
      hotkeyManager.keyDownHandler(keyDown)

      const keyUp: KeyboardEvent = new KeyboardEvent('keyup', init)
      hotkeyManager.keyUpHandler(keyUp)
      return true
    },
    payload,
  )
}

export async function pressChord(
  page: MinimalKeyboardPage,
  normalizedChord: string,
): Promise<'hotkey-manager' | 'playwright'> {
  if (await tryPressViaHotkeyManager(page, normalizedChord)) {
    return 'hotkey-manager'
  }

  await page.keyboard.press(normalizedChord)
  return 'playwright'
}
