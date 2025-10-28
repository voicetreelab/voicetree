/**
 * Simple event emitter for managing callbacks
 *
 * Usage:
 * ```typescript
 * const emitter = new EventEmitter<string>();
 * const unsubscribe = emitter.on((data) => console.log(data));
 * emitter.emit('hello');
 * unsubscribe();
 * ```
 */
export class EventEmitter<T> {
  private listeners: Set<(data: T) => void> = new Set();

  /**
   * Register a callback for events
   * @param callback - Function to call when event is emitted
   * @returns Unsubscribe function to remove the listener
   */
  on(callback: (data: T) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Emit an event to all registered listeners
   * @param data - Data to pass to listeners
   */
  emit(data: T): void {
    this.listeners.forEach(cb => cb(data));
  }

  /**
   * Remove all listeners
   */
  clear(): void {
    this.listeners.clear();
  }
}
