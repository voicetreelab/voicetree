export type SelectionMode = 'replace' | 'add' | 'remove'

export function applySelection(
  set: Set<string>,
  ids: readonly string[],
  mode: SelectionMode,
): Set<string> {
  switch (mode) {
    case 'replace':
      set.clear()
      for (const id of ids) {
        set.add(id)
      }
      return set
    case 'add':
      for (const id of ids) {
        set.add(id)
      }
      return set
    case 'remove':
      for (const id of ids) {
        set.delete(id)
      }
      return set
  }
}
