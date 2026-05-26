export function fail(message: string): never {
  throw new Error(message)
}

export function getRequiredValue(parsedArgs: readonly string[], index: number, flag: string): string {
  const value: string | undefined = parsedArgs[index]
  if (!value || value.startsWith('--')) {
    fail(`${flag} requires a value`)
  }

  return value
}
