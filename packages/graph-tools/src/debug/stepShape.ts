import type { SerializedCommand } from '@vt/graph-state'

export type ClickStep = { click: string }
export type TypeStep = { type: string; selector?: string }
export type PressStep = { press: string; selector?: string }
export type WaitStep = { wait: number }
export type WaitForStep = { waitFor: string; timeoutMs?: number }
export type NavigateStep = { navigate: string }
export type DispatchStep = { dispatch: SerializedCommand }

export type StepSpec =
  | ClickStep
  | TypeStep
  | PressStep
  | WaitStep
  | WaitForStep
  | NavigateStep
  | DispatchStep

export type StepValidation =
  | { ok: true; step: StepSpec }
  | { ok: false; error: string }

export const STEP_SPEC_SELECTOR_NOTE =
  'Selectors are plain CSS selectors. For hover-editor content, use #window-<nodeId>-editor .cm-content rather than #hover-editor.'

const STEP_KEYS = ['click', 'type', 'press', 'wait', 'waitFor', 'navigate', 'dispatch'] as const
const COMMAND_TYPES = new Set([
  'Collapse',
  'Expand',
  'Select',
  'Deselect',
  'AddNode',
  'RemoveNode',
  'AddEdge',
  'RemoveEdge',
  'Move',
  'LoadRoot',
  'UnloadRoot',
  'SetZoom',
  'SetPan',
  'SetPositions',
  'RequestFit',
])

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

function readNonEmptyString(
  stepName: string,
  field: string,
  value: unknown,
): StepValidation | string {
  if (typeof value !== 'string' || value.trim() === '') {
    return { ok: false, error: `${stepName}.${field} must be a non-empty string` }
  }

  return value
}

function readOptionalSelector(
  stepName: string,
  input: Record<string, unknown>,
): StepValidation | string | undefined {
  if (!('selector' in input)) return undefined
  return readNonEmptyString(stepName, 'selector', input.selector)
}

function readNumber(
  stepName: string,
  field: string,
  value: unknown,
  opts: { min: number },
): StepValidation | number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, error: `${stepName}.${field} must be a finite number` }
  }

  if (value < opts.min) {
    return { ok: false, error: `${stepName}.${field} must be >= ${opts.min}` }
  }

  return value
}

function rejectExtraKeys(
  stepName: string,
  input: Record<string, unknown>,
  allowedKeys: readonly string[],
): StepValidation | null {
  const extras = Object.keys(input).filter(key => !allowedKeys.includes(key))
  if (extras.length === 0) return null
  return {
    ok: false,
    error: `${stepName} step has unsupported field(s): ${extras.join(', ')}`,
  }
}

function readSerializedCommand(value: unknown): StepValidation | SerializedCommand {
  if (!isRecord(value)) {
    return { ok: false, error: 'dispatch.dispatch must be an object with a string type field' }
  }

  if (typeof value.type !== 'string') {
    return { ok: false, error: 'dispatch.dispatch.type must be a non-empty string' }
  }

  if (!COMMAND_TYPES.has(value.type)) {
    return {
      ok: false,
      error: `dispatch.dispatch.type must be one of: ${[...COMMAND_TYPES].join(', ')}`,
    }
  }

  return value as SerializedCommand
}

export function validateStepSpec(input: unknown): StepValidation {
  if (!isRecord(input)) {
    return { ok: false, error: 'step must be an object' }
  }

  const presentStepKeys = STEP_KEYS.filter(key => key in input)
  if (presentStepKeys.length !== 1) {
    return {
      ok: false,
      error: `step must contain exactly one of: ${STEP_KEYS.join(', ')}`,
    }
  }

  const stepName = presentStepKeys[0]

  switch (stepName) {
    case 'click': {
      const extraKeys = rejectExtraKeys('click', input, ['click'])
      if (extraKeys) return extraKeys
      const click = readNonEmptyString('click', 'click', input.click)
      if (typeof click !== 'string') return click
      return { ok: true, step: { click } }
    }

    case 'type': {
      const extraKeys = rejectExtraKeys('type', input, ['type', 'selector'])
      if (extraKeys) return extraKeys
      const text = readNonEmptyString('type', 'type', input.type)
      if (typeof text !== 'string') return text
      const selector = readOptionalSelector('type', input)
      if (selector && typeof selector !== 'string') return selector
      return { ok: true, step: selector ? { type: text, selector } : { type: text } }
    }

    case 'press': {
      const extraKeys = rejectExtraKeys('press', input, ['press', 'selector'])
      if (extraKeys) return extraKeys
      const press = readNonEmptyString('press', 'press', input.press)
      if (typeof press !== 'string') return press
      const selector = readOptionalSelector('press', input)
      if (selector && typeof selector !== 'string') return selector
      return { ok: true, step: selector ? { press, selector } : { press } }
    }

    case 'wait': {
      const extraKeys = rejectExtraKeys('wait', input, ['wait'])
      if (extraKeys) return extraKeys
      const wait = readNumber('wait', 'wait', input.wait, { min: 0 })
      if (typeof wait !== 'number') return wait
      return { ok: true, step: { wait } }
    }

    case 'waitFor': {
      const extraKeys = rejectExtraKeys('waitFor', input, ['waitFor', 'timeoutMs'])
      if (extraKeys) return extraKeys
      const waitFor = readNonEmptyString('waitFor', 'waitFor', input.waitFor)
      if (typeof waitFor !== 'string') return waitFor
      if (!('timeoutMs' in input)) {
        return { ok: true, step: { waitFor } }
      }
      const timeoutMs = readNumber('waitFor', 'timeoutMs', input.timeoutMs, { min: 0 })
      if (typeof timeoutMs !== 'number') return timeoutMs
      return { ok: true, step: { waitFor, timeoutMs } }
    }

    case 'navigate': {
      const extraKeys = rejectExtraKeys('navigate', input, ['navigate'])
      if (extraKeys) return extraKeys
      const navigate = readNonEmptyString('navigate', 'navigate', input.navigate)
      if (typeof navigate !== 'string') return navigate
      return { ok: true, step: { navigate } }
    }

    case 'dispatch': {
      const extraKeys = rejectExtraKeys('dispatch', input, ['dispatch'])
      if (extraKeys) return extraKeys
      const command = readSerializedCommand(input.dispatch)
      if ('ok' in command && command.ok === false) return command
      return { ok: true, step: { dispatch: command } }
    }
  }
}
