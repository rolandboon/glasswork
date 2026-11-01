import { describe, expect, it, vi } from 'vitest';
import { createCloudWatchTracker } from '../../src/observability/exception-tracking.js';

const sdk = vi.hoisted(() => {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { ready, release, construct: vi.fn(), send: vi.fn(async () => ({})), destroy: vi.fn() };
});
vi.mock('@aws-sdk/client-cloudwatch', async () => {
  await sdk.ready;
  return {
    CloudWatchClient: class {
      constructor() {
        sdk.construct();
      }
      send = sdk.send;
      destroy = sdk.destroy;
    },
    PutMetricDataCommand: class {},
  };
});

describe('owned CloudWatch clients', () => {
  it('releases a client whose lazy import finishes after the close deadline', async () => {
    const tracker = createCloudWatchTracker({ logToConsole: false });
    tracker.captureException(new Error('one'));
    await expect(tracker.close?.(5)).resolves.toEqual({ completed: false, pending: 1 });
    sdk.release();
    await vi.waitFor(() => expect(sdk.construct).toHaveBeenCalledTimes(1));
    await tracker.flush?.(100);
    expect(sdk.destroy).toHaveBeenCalledTimes(1);
    expect(sdk.send).not.toHaveBeenCalled();
  });

  it('shares lazy initialization and disposes the owned client exactly once', async () => {
    vi.clearAllMocks();
    const tracker = createCloudWatchTracker({ logToConsole: false });
    tracker.captureException(new Error('one'));
    tracker.captureException(new Error('two'));
    await tracker.flush?.(100);
    expect(sdk.construct).toHaveBeenCalledTimes(1);
    expect(sdk.send).toHaveBeenCalledTimes(2);
    await Promise.all([tracker.close?.(100), tracker.close?.(100)]);
    await tracker.close?.(100);
    expect(sdk.destroy).toHaveBeenCalledTimes(1);
  });
});
