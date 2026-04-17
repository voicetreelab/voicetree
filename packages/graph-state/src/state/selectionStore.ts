import type { NodeIdAndFilePath } from '@vt/graph-model/pure/graph'

import { applyCommandWithDelta, emptyState } from '../applyCommand'
import type { Unsubscribe } from '../contract'

type SelectionSubscriber = (selection: ReadonlySet<NodeIdAndFilePath>) => void

let _state = emptyState()
const _subscribers = new Set<SelectionSubscriber>()

export function getSelection(): ReadonlySet<NodeIdAndFilePath> {
    return _state.selection
}

export function isSelected(id: NodeIdAndFilePath): boolean {
    return _state.selection.has(id)
}

export function dispatchSelect(ids: readonly NodeIdAndFilePath[], additive?: boolean): void {
    const { state, delta } = applyCommandWithDelta(_state, { type: 'Select', ids, additive })
    if (delta.selectionAdded !== undefined || delta.selectionRemoved !== undefined) {
        _state = state
        _notifySubscribers()
    }
}

export function dispatchDeselect(ids: readonly NodeIdAndFilePath[]): void {
    const { state, delta } = applyCommandWithDelta(_state, { type: 'Deselect', ids })
    if (delta.selectionRemoved !== undefined) {
        _state = state
        _notifySubscribers()
    }
}

export function subscribeSelection(cb: SelectionSubscriber): Unsubscribe {
    _subscribers.add(cb)
    return () => { _subscribers.delete(cb) }
}

/** Resets store to empty state and clears subscribers. Use in tests only. */
export function _resetForTests(): void {
    _state = emptyState()
    _subscribers.clear()
}

function _notifySubscribers(): void {
    for (const cb of _subscribers) {
        cb(_state.selection)
    }
}
