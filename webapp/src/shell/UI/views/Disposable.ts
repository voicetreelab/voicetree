/**
 * Disposable base class pattern for managing lifecycle and cleanup.
 *
 * Usage:
 * ```typescript
 * class MyClass extends Disposable {
 *   constructor() {
 *     super();
 *     // Setup resources
 *   }
 *
 *   dispose(): void {
 *     // Cleanup resources
 *     super.dispose();
 *   }
 * }
 * ```
 */
export abstract class Disposable {
  private _isDisposed = false;

  /**
   * Check if this instance has been disposed
   */
  get isDisposed(): boolean {
    return this._isDisposed;
  }

  /**
   * Dispose of resources. Subclasses should override and call super.dispose() at the end.
   */
  dispose(): void {
    if (this._isDisposed) {
      return;
    }
    this._isDisposed = true;
  }
}
