/**
 * Simple event emitter with typed events
 *
 * Usage:
 * ```typescript
 * const emitter = new EventEmitter<string>();
 * const unsubscribe = emitter.on((data) => //console.log(data));
 * emitter.emit('hello');
 * unsubscribe();
 * ```
 */
export class EventEmitter<T> {
  private callbacks: Array<(data: T) => void> = [];

  /**
   * Subscribe to events
   * @param callback Function to call when event is emitted
   * @returns Unsubscribe function
   */
  on(callback: (data: T) => void): () => void {
    this.callbacks.push(callback);
    return () => {
      const index: number = this.callbacks.indexOf(callback);
      if (index > -1) {
        this.callbacks.splice(index, 1);
      }
    };
  }

  /**
   * Emit event to all subscribers
   * @param data Event data
   */
  emit(data: T): void {
    // Create a copy to avoid issues if callbacks modify the array
    const callbacksCopy: ((data: T) => void)[] = [...this.callbacks];
    for (const callback of callbacksCopy) {
      callback(data);
    }
  }

  /**
   * Remove all subscribers
   */
  clear(): void {
    this.callbacks = [];
  }

  /**
   * Get the number of subscribers
   */
  get listenerCount(): number {
    return this.callbacks.length;
  }
}
