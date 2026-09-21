import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const gettingStartedGuide = readFileSync(
  new URL('../../docs/auth/getting-started.md', import.meta.url),
  'utf8'
);

describe('auth documentation security defaults', () => {
  it('keeps the example role field out of public Better Auth input', () => {
    expect(gettingStartedGuide).toMatch(
      /role:\s*\{[\s\S]*?defaultValue:\s*'member',[\s\S]*?input:\s*false,[\s\S]*?\}/
    );
    expect(gettingStartedGuide).toContain(
      'Always disable client input for authorization data such as'
    );
  });
});
