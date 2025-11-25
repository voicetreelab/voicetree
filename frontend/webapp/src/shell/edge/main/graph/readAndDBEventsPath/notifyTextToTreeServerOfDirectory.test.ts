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

  it('should retry on failure until backend succeeds', async () => {
    // GIVEN: Backend fails twice, then succeeds
    const loadDirMock = vi.spyOn(backendApi, 'tellSTTServerToLoadDirectory')
      .mockRejectedValueOnce(new Error('Connection error'))
      .mockRejectedValueOnce(new Error('Connection error'))
      .mockResolvedValueOnce({
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
});
