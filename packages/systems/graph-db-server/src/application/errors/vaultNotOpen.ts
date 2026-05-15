export type StructuredVaultErrorCode = 'vault_not_open' | 'vault_open_failed'

export class StructuredVaultError extends Error {
  readonly status = 409

  constructor(
    public readonly code: StructuredVaultErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'StructuredVaultError'
  }

  toResponseBody(): { error: { code: StructuredVaultErrorCode; message: string } } {
    return { error: { code: this.code, message: this.message } }
  }
}

export class VaultNotOpenError extends StructuredVaultError {
  constructor(message = 'A vault must be opened before using this endpoint') {
    super('vault_not_open', message)
    this.name = 'VaultNotOpenError'
  }
}

export class VaultOpenFailedError extends StructuredVaultError {
  constructor(message = 'Failed to open vault') {
    super('vault_open_failed', message)
    this.name = 'VaultOpenFailedError'
  }
}

export function structuredVaultErrorResult(
  error: StructuredVaultError,
): { readonly kind: 'json'; readonly body: unknown; readonly status: number } {
  return { kind: 'json', body: error.toResponseBody(), status: error.status }
}
