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
    // GIVEN: Backend succeeds
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

    expect(loadDirMock).toHaveBeenCalledWith('/test/path');
    expect(loadDirMock).toHaveBeenCalledTimes(1);
  });

  it('should retry every 5 seconds when backend fails, then succeed', async () => {
    // GIVEN: Backend fails for first 2 attempts, then succeeds
    const loadDirMock = vi.spyOn(backendApi, 'tellSTTServerToLoadDirectory')
      .mockRejectedValueOnce(new Error('Connection error'))  // Attempt 1: fails
      .mockRejectedValueOnce(new Error('Connection error'))  // Attempt 2: fails
      .mockResolvedValueOnce({                               // Attempt 3: succeeds
        status: 'success',
        message: 'Directory loaded',
        directory: '/test/path',
        nodes_loaded: 5
      });

    // WHEN: Notify about directory
    notifyTextToTreeServerOfDirectory('/test/path');

    // THEN: First attempt fails
    await vi.advanceTimersByTimeAsync(0);
    expect(loadDirMock).toHaveBeenCalledTimes(1);

    // THEN: Second attempt after 5 seconds
    await vi.advanceTimersByTimeAsync(5000);
    expect(loadDirMock).toHaveBeenCalledTimes(2);

    // THEN: Third attempt succeeds after another 5 seconds
    await vi.advanceTimersByTimeAsync(5000);
    expect(loadDirMock).toHaveBeenCalledWith('/test/path');
    expect(loadDirMock).toHaveBeenCalledTimes(3);
  });

  it('should retry when API call fails', async () => {
    // GIVEN: API fails once, then succeeds
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
    // GIVEN: Backend fails for many attempts, then succeeds
    const loadDirMock = vi.spyOn(backendApi, 'tellSTTServerToLoadDirectory')
      .mockRejectedValue(new Error('Connection error'));

    // WHEN: Notify about directory
    notifyTextToTreeServerOfDirectory('/test/path');

    // THEN: Should keep retrying (test 10 attempts)
    await vi.advanceTimersByTimeAsync(0);
    expect(loadDirMock).toHaveBeenCalledTimes(1);

    for (let i = 2; i <= 10; i++) {
      await vi.advanceTimersByTimeAsync(5000);
      expect(loadDirMock).toHaveBeenCalledTimes(i);
    }

    // Now make it succeed
    loadDirMock.mockResolvedValue({
      status: 'success',
      message: 'Directory loaded',
      directory: '/test/path',
      nodes_loaded: 5
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(loadDirMock).toHaveBeenCalledWith('/test/path');
  });

  it('should handle multiple calls to notifyTextToTreeServerOfDirectory', async () => {
    // GIVEN: Backend succeeds
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
