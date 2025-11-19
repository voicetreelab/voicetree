import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { notifyTextToTreeServerOfDirectory } from './notifyTextToTreeServerOfDirectory';
import * as backendApi from '@/shell/edge/main/backend-api';

describe('notifyTextToTreeServerOfDirectory', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('should successfully notify backend when it is ready immediately', async () => {
    // GIVEN: Backend is ready
    const healthCheckMock = vi.spyOn(backendApi, 'checkBackendHealth')
      .mockResolvedValue(true);

    const loadDirMock = vi.spyOn(backendApi, 'tellSTTServerToLoadDirectory')
      .mockResolvedValue({
        status: 'success',
        message: 'Directory loaded',
        directory: '/test/path',
        nodes_loaded: 5
      });

    // WHEN: Notify about directory
    notifyTextToTreeServerOfDirectory('/test/path');

    // THEN: Should call backend immediately
    await vi.runOnlyPendingTimersAsync();

    expect(healthCheckMock).toHaveBeenCalledTimes(1);
    expect(loadDirMock).toHaveBeenCalledWith('/test/path');
    expect(loadDirMock).toHaveBeenCalledTimes(1);
  });

  it('should retry every 5 seconds when backend not ready, then succeed', async () => {
    // GIVEN: Backend not ready for first 2 attempts, then ready
    const healthCheckMock = vi.spyOn(backendApi, 'checkBackendHealth')
      .mockResolvedValueOnce(false)  // Attempt 1: not ready
      .mockResolvedValueOnce(false)  // Attempt 2: not ready
      .mockResolvedValueOnce(true);  // Attempt 3: ready!

    const loadDirMock = vi.spyOn(backendApi, 'tellSTTServerToLoadDirectory')
      .mockResolvedValue({
        status: 'success',
        message: 'Directory loaded',
        directory: '/test/path',
        nodes_loaded: 5
      });

    // WHEN: Notify about directory
    notifyTextToTreeServerOfDirectory('/test/path');

    // THEN: First attempt checks health (flush microtasks only)
    await vi.advanceTimersByTimeAsync(0);
    expect(healthCheckMock).toHaveBeenCalledTimes(1);
    expect(loadDirMock).not.toHaveBeenCalled();

    // THEN: Second attempt after 5 seconds
    await vi.advanceTimersByTimeAsync(5000);
    expect(healthCheckMock).toHaveBeenCalledTimes(2);
    expect(loadDirMock).not.toHaveBeenCalled();

    // THEN: Third attempt succeeds after another 5 seconds
    await vi.advanceTimersByTimeAsync(5000);
    expect(healthCheckMock).toHaveBeenCalledTimes(3);
    expect(loadDirMock).toHaveBeenCalledWith('/test/path');
    expect(loadDirMock).toHaveBeenCalledTimes(1);
  });

  it('should retry when health check throws error', async () => {
    // GIVEN: Health check fails first, then succeeds
    const healthCheckMock = vi.spyOn(backendApi, 'checkBackendHealth')
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(true);

    const loadDirMock = vi.spyOn(backendApi, 'tellSTTServerToLoadDirectory')
      .mockResolvedValue({
        status: 'success',
        message: 'Directory loaded',
        directory: '/test/path',
        nodes_loaded: 5
      });

    // WHEN: Notify about directory
    notifyTextToTreeServerOfDirectory('/test/path');

    // THEN: First attempt catches error (returns false from .catch(() => false))
    await vi.advanceTimersByTimeAsync(0);
    expect(healthCheckMock).toHaveBeenCalledTimes(1);
    expect(loadDirMock).not.toHaveBeenCalled();

    // THEN: Retries after 5 seconds and succeeds
    await vi.advanceTimersByTimeAsync(5000);
    expect(healthCheckMock).toHaveBeenCalledTimes(2);
    expect(loadDirMock).toHaveBeenCalledWith('/test/path');
  });

  it('should retry when API call fails', async () => {
    // GIVEN: Backend ready but API fails once, then succeeds
    vi.spyOn(backendApi, 'checkBackendHealth')
      .mockResolvedValue(true);

    const loadDirMock = vi.spyOn(backendApi, 'tellSTTServerToLoadDirectory')
      .mockRejectedValueOnce(new Error('API error'))
      .mockResolvedValueOnce({
        status: 'success',
        message: 'Directory loaded',
        directory: '/test/path',
        nodes_loaded: 5
      });

    // WHEN: Notify about directory
    notifyTextToTreeServerOfDirectory('/test/path');
    await vi.advanceTimersByTimeAsync(0);

    // THEN: First call fails
    expect(loadDirMock).toHaveBeenCalledTimes(1);

    // THEN: Retries after 5 seconds and succeeds
    await vi.advanceTimersByTimeAsync(5000);
    expect(loadDirMock).toHaveBeenCalledTimes(2);
    expect(loadDirMock).toHaveBeenCalledWith('/test/path');
  });

  it('should continue retrying indefinitely until success', async () => {
    // GIVEN: Backend not ready for many attempts
    const healthCheckMock = vi.spyOn(backendApi, 'checkBackendHealth')
      .mockResolvedValue(false);

    const loadDirMock = vi.spyOn(backendApi, 'tellSTTServerToLoadDirectory')
      .mockResolvedValue({
        status: 'success',
        message: 'Directory loaded',
        directory: '/test/path',
        nodes_loaded: 5
      });

    // WHEN: Notify about directory
    notifyTextToTreeServerOfDirectory('/test/path');

    // THEN: Should keep retrying (test 10 attempts)
    await vi.advanceTimersByTimeAsync(0);
    expect(healthCheckMock).toHaveBeenCalledTimes(1);

    for (let i = 2; i <= 10; i++) {
      await vi.advanceTimersByTimeAsync(5000);
      expect(healthCheckMock).toHaveBeenCalledTimes(i);
      expect(loadDirMock).not.toHaveBeenCalled();
    }

    // Now make it succeed
    healthCheckMock.mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(loadDirMock).toHaveBeenCalledWith('/test/path');
  });

  it('should handle multiple calls to notifyTextToTreeServerOfDirectory', async () => {
    // GIVEN: Backend is ready
    vi.spyOn(backendApi, 'checkBackendHealth')
      .mockResolvedValue(true);

    const loadDirMock = vi.spyOn(backendApi, 'tellSTTServerToLoadDirectory')
      .mockResolvedValue({
        status: 'success',
        message: 'Directory loaded',
        directory: '/test/path',
        nodes_loaded: 5
      });

    // WHEN: Called multiple times (simulating user switching folders)
    notifyTextToTreeServerOfDirectory('/path/A');
    notifyTextToTreeServerOfDirectory('/path/B');
    notifyTextToTreeServerOfDirectory('/path/C');

    await vi.runOnlyPendingTimersAsync();

    // THEN: All three attempts should complete
    // (Each creates its own independent retry chain)
    expect(loadDirMock).toHaveBeenCalledWith('/path/A');
    expect(loadDirMock).toHaveBeenCalledWith('/path/B');
    expect(loadDirMock).toHaveBeenCalledWith('/path/C');
    expect(loadDirMock).toHaveBeenCalledTimes(3);
  });
});
