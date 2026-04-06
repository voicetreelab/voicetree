import { describe, it, expect, vi, beforeEach } from 'vitest';
import { notifyTextToTreeServerOfDirectory } from './notifyTextToTreeServerOfDirectory';
import { initGraphModel } from '@vt/graph-model';

describe('notifyTextToTreeServerOfDirectory', () => {
  let mockNotifyWriteDirectory: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockNotifyWriteDirectory = vi.fn();
    initGraphModel(
      { appSupportPath: '/tmp/test-notify' },
      { notifyWriteDirectory: mockNotifyWriteDirectory }
    );
  });

  it('should call notifyWriteDirectory callback with directory path', () => {
    notifyTextToTreeServerOfDirectory('/test/path');
    expect(mockNotifyWriteDirectory).toHaveBeenCalledWith('/test/path');
    expect(mockNotifyWriteDirectory).toHaveBeenCalledTimes(1);
  });

  it('should not throw when notifyWriteDirectory callback is not set', () => {
    initGraphModel({ appSupportPath: '/tmp/test-notify' }, {});
    expect(() => notifyTextToTreeServerOfDirectory('/test/path')).not.toThrow();
  });
});
