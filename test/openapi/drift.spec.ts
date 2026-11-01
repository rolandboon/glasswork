import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertOpenAPIMatches,
  diffOpenAPI,
  OpenAPIDriftError,
  writeOpenAPIDocument,
} from '../../src/openapi/drift.js';

const saved = {
  openapi: '3.1.0',
  paths: {
    '/api/projects': {
      get: {
        responses: {
          200: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { id: {}, name: {} },
                  required: ['id', 'name'],
                },
              },
            },
          },
        },
      },
    },
    '/api/legacy': { delete: { responses: { 204: {} } } },
  },
  components: { schemas: { Project: { type: 'object' }, Legacy: { type: 'object' } } },
};

function changed() {
  const document = structuredClone(saved) as typeof saved & {
    paths: Record<string, unknown>;
    components: { schemas: Record<string, unknown> };
  };
  const schema =
    document.paths['/api/projects'].get.responses[200].content['application/json'].schema;
  delete (schema.properties as Record<string, unknown>).name;
  schema.required = ['id'];
  delete document.paths['/api/legacy'];
  document.paths['/api/invitations'] = { post: { responses: { 202: {} } } };
  delete document.components.schemas.Legacy;
  return document;
}

let directory: string | undefined;
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

async function savedContract() {
  directory = await mkdtemp(join(tmpdir(), 'glasswork-drift-'));
  const path = join(directory, 'openapi.json');
  await writeOpenAPIDocument(saved, path);
  return path;
}

describe('OpenAPI contract drift', () => {
  it('writes indented JSON that the check reads back unchanged', async () => {
    const path = await savedContract();

    expect(await readFile(path, 'utf8')).toBe(`${JSON.stringify(saved, null, 2)}\n`);
    await expect(assertOpenAPIMatches(saved, path)).resolves.toBeUndefined();
  });

  it('names the operations and schemas that changed', async () => {
    const path = await savedContract();

    const error = await assertOpenAPIMatches(changed(), path).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(OpenAPIDriftError);
    expect((error as Error).message).toBe(
      [
        `OpenAPI contract drift in ${path}:`,
        '  ~ GET /api/projects: responses/200/content/application~1json/schema/properties/name removed',
        '  ~ GET /api/projects: responses/200/content/application~1json/schema/required changed',
        '  - /api/legacy',
        '  + /api/invitations',
        '  - schema Legacy',
        `Regenerate and commit ${path} if the change is intended.`,
      ].join('\n')
    );
  });

  it('exposes the differences for tooling', () => {
    expect(diffOpenAPI(saved, changed())).toEqual([
      {
        kind: 'removed',
        pointer:
          '/paths/~1api~1projects/get/responses/200/content/application~1json/schema/properties/name',
      },
      {
        kind: 'changed',
        pointer:
          '/paths/~1api~1projects/get/responses/200/content/application~1json/schema/required',
      },
      { kind: 'removed', pointer: '/paths/~1api~1legacy' },
      { kind: 'added', pointer: '/paths/~1api~1invitations' },
      { kind: 'removed', pointer: '/components/schemas/Legacy' },
    ]);
  });

  it('limits the message to the first twenty differences', () => {
    const differences = Array.from({ length: 25 }, (_, index) => ({
      kind: 'added' as const,
      pointer: `/components/schemas/Schema${index}`,
    }));

    const message = new OpenAPIDriftError('openapi.json', differences).message;

    expect(message.split('\n')).toHaveLength(23);
    expect(message).toContain('… and 5 more');
  });
});
