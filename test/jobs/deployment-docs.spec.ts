import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';

// Parse the actual published examples, including CloudFormation scalar tags.
const examples = readdirSync(new URL('../../docs/jobs/', import.meta.url))
  .filter((name) => name.endsWith('.md'))
  .flatMap((name) => {
    const markdown = readFileSync(new URL(`../../docs/jobs/${name}`, import.meta.url), 'utf8');
    return [...markdown.matchAll(/```ya?ml\n([\s\S]*?)```/g)]
      .filter((match) => /Type:\s*SQS\b/.test(match[1]))
      .map((match, index) => ({ name: `${name}:${index}`, source: match[1] }));
  });
function sqsEvents(node: unknown): Record<string, unknown>[] {
  if (!node || typeof node !== 'object') return [];
  const record = node as Record<string, unknown>;
  return [...(record.Type === 'SQS' ? [record] : []), ...Object.values(record).flatMap(sqsEvents)];
}

describe('SQS deployment examples', () => {
  it('covers each documented worker deployment', () => {
    expect(examples.map((entry) => entry.name.split(':')[0]).sort()).toEqual([
      'aws-setup.md',
      'getting-started.md',
      'workers.md',
    ]);
  });
  it.each(examples)('$name enables partial batch responses on the event source', ({ source }) => {
    const document = parseDocument(source, {
      customTags: ['!Ref', '!Sub', '!GetAtt'].map((tag) => ({
        tag,
        resolve: (value: string) => value,
      })),
    });
    expect(document.errors).toEqual([]);
    const events = sqsEvents(document.toJS());
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      const properties = event.Properties as Record<string, unknown>;
      expect(properties.FunctionResponseTypes).toContain('ReportBatchItemFailures');
      expect(properties.Queue).toBeTruthy();
    }
  });
});
