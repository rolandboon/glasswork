import { describe, expect, it, vi } from 'vitest';
import { optionalDependency } from '../../src/utils/optional-dependency.js';

describe('optionalDependency', () => {
  it('loads the module once', async () => {
    const load = vi.fn(async () => ({ Client: class {} }));
    const loadClient = optionalDependency('@aws-sdk/client-x', 'XDriver', load);

    const [first, second] = await Promise.all([loadClient(), loadClient()]);

    expect(first).toBe(second);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('names the missing package and how to install it', async () => {
    const missing = Object.assign(new Error("Cannot find package '@aws-sdk/client-x'"), {
      code: 'ERR_MODULE_NOT_FOUND',
    });
    const loadClient = optionalDependency('@aws-sdk/client-x', 'XDriver', async () => {
      throw missing;
    });

    await expect(loadClient()).rejects.toMatchObject({
      message: 'XDriver requires @aws-sdk/client-x. Install it with: npm install @aws-sdk/client-x',
      cause: missing,
    });
  });

  it('tries again after a failed load', async () => {
    const load = vi
      .fn<() => Promise<object>>()
      .mockRejectedValueOnce(new Error('missing'))
      .mockResolvedValueOnce({ ok: true });
    const loadModule = optionalDependency('x', 'X', load);

    await expect(loadModule()).rejects.toThrow('X requires x');
    await expect(loadModule()).resolves.toEqual({ ok: true });
  });
});
