export async function waitFor(
  read: () => Promise<boolean>,
  timeoutMs = 8000,
  pollIntervalMs = 50,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await read()) return
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }
  throw new Error('waitFor: condition not met before timeout')
}
