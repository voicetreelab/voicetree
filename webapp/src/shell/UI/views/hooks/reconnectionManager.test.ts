import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createReconnectionState,
  shouldRetry,
  recordAttempt,
  resetAttempts,
  scheduleReconnection,
  MAX_RECONNECT_ATTEMPTS,
  RECONNECT_DELAY_MS,
} from './reconnectionManager';

describe('reconnectionManager', () => {
  describe('constants', () => {
    it('has expected default values', () => {
      expect(MAX_RECONNECT_ATTEMPTS).toBe(1);
      expect(RECONNECT_DELAY_MS).toBe(1000);
    });
  });

  describe('createReconnectionState', () => {
    it('creates state with zero attempts', () => {
      const state = createReconnectionState();
      expect(state.attempts).toBe(0);
    });
  });

  describe('shouldRetry', () => {
    it('returns true when attempts below max and recording', () => {
      const state = { attempts: 0 };
      expect(shouldRetry(state, true)).toBe(true);
    });

    it('returns false when attempts at max', () => {
      const state = { attempts: MAX_RECONNECT_ATTEMPTS };
      expect(shouldRetry(state, true)).toBe(false);
    });

    it('returns false when not recording', () => {
      const state = { attempts: 0 };
      expect(shouldRetry(state, false)).toBe(false);
    });

    it('returns false when both at max and not recording', () => {
      const state = { attempts: MAX_RECONNECT_ATTEMPTS };
      expect(shouldRetry(state, false)).toBe(false);
    });

    it('respects custom maxAttempts parameter', () => {
      const state = { attempts: 2 };
      expect(shouldRetry(state, true, 3)).toBe(true);
      expect(shouldRetry(state, true, 2)).toBe(false);
    });
  });

  describe('recordAttempt', () => {
    it('increments attempts by one', () => {
      const state = { attempts: 0 };
      const newState = recordAttempt(state);
      expect(newState.attempts).toBe(1);
    });

    it('returns a new state object (immutable)', () => {
      const state = { attempts: 0 };
      const newState = recordAttempt(state);
      expect(newState).not.toBe(state);
      expect(state.attempts).toBe(0); // Original unchanged
    });

    it('accumulates multiple attempts', () => {
      let state = createReconnectionState();
      state = recordAttempt(state);
      state = recordAttempt(state);
      state = recordAttempt(state);
      expect(state.attempts).toBe(3);
    });
  });

  describe('resetAttempts', () => {
    it('returns state with zero attempts', () => {
      const state = resetAttempts();
      expect(state.attempts).toBe(0);
    });
  });

  describe('scheduleReconnection', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('calls onReconnect after delay when shouldProceed returns true', () => {
      const onReconnect = vi.fn();
      scheduleReconnection(() => true, onReconnect);

      expect(onReconnect).not.toHaveBeenCalled();

      vi.advanceTimersByTime(RECONNECT_DELAY_MS);

      expect(onReconnect).toHaveBeenCalledTimes(1);
    });

    it('does not call onReconnect when shouldProceed returns false', () => {
      const onReconnect = vi.fn();
      scheduleReconnection(() => false, onReconnect);

      vi.advanceTimersByTime(RECONNECT_DELAY_MS);

      expect(onReconnect).not.toHaveBeenCalled();
    });

    it('evaluates shouldProceed at execution time, not schedule time', () => {
      const onReconnect = vi.fn();
      let proceed = true;
      scheduleReconnection(() => proceed, onReconnect);

      // Change condition after scheduling but before execution
      proceed = false;

      vi.advanceTimersByTime(RECONNECT_DELAY_MS);

      expect(onReconnect).not.toHaveBeenCalled();
    });

    it('uses custom delay when provided', () => {
      const onReconnect = vi.fn();
      const customDelay = 500;
      scheduleReconnection(() => true, onReconnect, customDelay);

      vi.advanceTimersByTime(customDelay - 1);
      expect(onReconnect).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(onReconnect).toHaveBeenCalledTimes(1);
    });

    it('returns cleanup function that cancels scheduled reconnection', () => {
      const onReconnect = vi.fn();
      const cleanup = scheduleReconnection(() => true, onReconnect);

      vi.advanceTimersByTime(500); // Halfway through delay
      cleanup();

      vi.advanceTimersByTime(1000); // Past original delay

      expect(onReconnect).not.toHaveBeenCalled();
    });
  });
});
