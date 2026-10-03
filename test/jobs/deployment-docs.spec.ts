import { readdirSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

// Inspect the published CDK examples without adding CDK as a framework dependency.
const examples = readdirSync(new URL('../../docs/jobs/', import.meta.url))
  .filter((name) => name.endsWith('.md'))
  .flatMap((name) => {
    const markdown = readFileSync(new URL(`../../docs/jobs/${name}`, import.meta.url), 'utf8');
    return [...markdown.matchAll(/```typescript\n([\s\S]*?)```/g)]
      .filter((match) => /new\s+SqsEventSource\s*\(/.test(match[1]))
      .map((match, index) => ({ name: `${name}:${index}`, source: match[1] }));
  });

describe('SQS deployment examples', () => {
  it('covers each documented worker deployment', () => {
    expect([...new Set(examples.map((entry) => entry.name.split(':')[0]))].sort()).toEqual([
      'aws-setup.md',
      'error-handling.md',
      'getting-started.md',
      'workers.md',
    ]);
  });
  it.each(examples)('$name enables partial batch responses on the event source', ({ source }) => {
    const constructors = [...source.matchAll(/new\s+SqsEventSource\s*\(/g)];
    const events = [
      ...source.matchAll(/new\s+SqsEventSource\s*\(\s*([\w$.]+)\s*,\s*(\{[^{}]*\})\s*,?\s*\)/g),
    ];
    // All examples must expose their options inline; never silently skip a constructor.
    expect(events).toHaveLength(constructors.length);
    for (const [, queue, options] of events) {
      expect(queue).not.toBe('undefined');
      expect(queue).not.toBe('null');
      const properties: unknown = runInNewContext(`(${options})`, {}, { timeout: 100 });
      expect(properties).toMatchObject({ reportBatchItemFailures: true });
    }
  });
});
