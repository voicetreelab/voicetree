const MODIFIER_MAP: Record<string, (platform: NodeJS.Platform) => string> = {
  alt: () => 'Alt',
  cmd: (platform) => (platform === 'darwin' ? 'Meta' : 'Control'),
  command: (platform) => (platform === 'darwin' ? 'Meta' : 'Control'),
  control: () => 'Control',
  ctrl: () => 'Control',
  meta: () => 'Meta',
  opt: () => 'Alt',
  option: () => 'Alt',
  shift: () => 'Shift',
  super: () => 'Meta',
}

export function normalizeChord(chord: string, platform: NodeJS.Platform = process.platform): string {
  return chord
    .split('+')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => MODIFIER_MAP[part.toLowerCase()]?.(platform) ?? part)
    .join('+')
}
