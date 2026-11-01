import { describe, expect, it } from 'vitest';
import { namedExports } from '../../src/utils/module-interop.js';

class SSMClient {}

describe('namedExports', () => {
  it('reads exports that a bundled CommonJS chunk only exposes as default', () => {
    const bundled = { default: { SSMClient } };

    expect(namedExports(bundled).SSMClient).toBe(SSMClient);
  });

  it('keeps the named exports of a regular module', () => {
    const module = { SSMClient, default: { SSMClient: class Other {} } };

    expect(namedExports(module).SSMClient).toBe(SSMClient);
  });

  it('returns a module without an object default unchanged', () => {
    const module = { swaggerUI: () => 'ui' };

    expect(namedExports(module)).toBe(module);
  });
});
