import { describe, expect, it } from 'vitest';
import { createRLSExtension } from '../../src/rls/extension.js';
import { RLSConfigurationException } from '../../src/rls/types.js';

describe('RLS configuration', () => {
  it.each([
    { sessionVariable: '' },
    { sessionVariable: 'tenant' },
    { sessionVariable: 'app.' },
    { bypassVariable: 'bypass' },
    { sessionVariable: 'app.tenant', bypassVariable: 'app.tenant' },
    { sessionVariable: 'app.tenant', bypassVariable: 'APP.TENANT' },
  ])('rejects invalid session variables: %j', (options) => {
    expect(() => createRLSExtension(options)).toThrow(RLSConfigurationException);
  });
});
