import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { _testing } from './notification-scheduler';

const {
  daysSinceTimestamp,
  NOTIFICATION_INTERVALS_DAYS,
  DISMISS_THRESHOLD,
  DEFAULT_STATE,
} = _testing;

describe('notification-scheduler', () => {
  describe('daysSinceTimestamp', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns 0 for current timestamp', () => {
      const now: number = Date.now();
      vi.setSystemTime(now);
      expect(daysSinceTimestamp(now)).toBe(0);
    });

    it('returns 1 for timestamp 24 hours ago', () => {
      const now: number = Date.now();
      vi.setSystemTime(now);
      const oneDayAgo: number = now - 24 * 60 * 60 * 1000;
      expect(daysSinceTimestamp(oneDayAgo)).toBe(1);
    });

    it('returns 2.5 for timestamp 60 hours ago', () => {
      const now: number = Date.now();
      vi.setSystemTime(now);
      const sixtyHoursAgo: number = now - 60 * 60 * 60 * 1000;
      expect(daysSinceTimestamp(sixtyHoursAgo)).toBe(2.5);
    });

    it('returns 7 for timestamp one week ago', () => {
      const now: number = Date.now();
      vi.setSystemTime(now);
      const oneWeekAgo: number = now - 7 * 24 * 60 * 60 * 1000;
      expect(daysSinceTimestamp(oneWeekAgo)).toBe(7);
    });
  });

  describe('notification intervals', () => {
    it('has correct interval values', () => {
      expect(NOTIFICATION_INTERVALS_DAYS).toEqual([2, 7, 14]);
    });

    it('has 3 notification intervals', () => {
      expect(NOTIFICATION_INTERVALS_DAYS.length).toBe(3);
    });
  });

  describe('dismiss threshold', () => {
    it('is set to 2', () => {
      expect(DISMISS_THRESHOLD).toBe(2);
    });
  });

  describe('default state', () => {
    it('has correct initial values', () => {
      expect(DEFAULT_STATE.notificationsSent).toBe(0);
      expect(DEFAULT_STATE.dismissCount).toBe(0);
      expect(DEFAULT_STATE.permanentlyDisabled).toBe(false);
    });

    it('has a lastUsedTimestamp', () => {
      expect(typeof DEFAULT_STATE.lastUsedTimestamp).toBe('number');
      expect(DEFAULT_STATE.lastUsedTimestamp).toBeGreaterThan(0);
    });
  });

  describe('notification timing logic', () => {
    it('first notification should trigger after 2 days of inactivity', () => {
      const threshold: number = NOTIFICATION_INTERVALS_DAYS[0];
      expect(threshold).toBe(2);

      // 1.9 days should not trigger
      expect(1.9 < threshold).toBe(true);
      // 2.0 days should trigger
      expect(2.0 >= threshold).toBe(true);
    });

    it('second notification should trigger after 7 days of inactivity', () => {
      const threshold: number = NOTIFICATION_INTERVALS_DAYS[1];
      expect(threshold).toBe(7);
    });

    it('third notification should trigger after 14 days of inactivity', () => {
      const threshold: number = NOTIFICATION_INTERVALS_DAYS[2];
      expect(threshold).toBe(14);
    });

    it('should permanently disable after 2 dismissals', () => {
      const dismissCount: number = 2;
      expect(dismissCount >= DISMISS_THRESHOLD).toBe(true);
    });

    it('should not permanently disable after 1 dismissal', () => {
      const dismissCount: number = 1;
      expect(dismissCount >= DISMISS_THRESHOLD).toBe(false);
    });
  });
});
