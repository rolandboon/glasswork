import type { OpenAPIV3_1 } from 'openapi-types';
import { describe, expect, it } from 'vitest';
import { transformOpenAPIDocument } from '../../src/openapi/openapi-transformer.js';

// Helper type for OpenAPI 3.0-style schemas with nullable property
// We use 'any' here intentionally to test transformation from OpenAPI 3.0 to 3.1
// biome-ignore lint/suspicious/noExplicitAny: Testing transformation from 3.0 to 3.1 requires flexible types
type OpenAPI30Schema = any;

describe('transformOpenAPIDocument', () => {
  it('should transform nullable anyOf to include explicit null type', () => {
    // Using 'as unknown as' because we're testing transformation FROM OpenAPI 3.0 TO 3.1
    const input = {
      openapi: '3.1.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: {},
      components: {
        schemas: {
          TestSchema: {
            type: 'object',
            properties: {
              name: {
                anyOf: [{ type: 'string', nullable: true }],
              },
            },
          },
        },
      },
    } as unknown as OpenAPIV3_1.Document;

    const result = transformOpenAPIDocument(input);
    const schema = result.components?.schemas?.TestSchema as OpenAPI30Schema;

    expect(schema.properties.name.anyOf).toHaveLength(2);
    expect(schema.properties.name.anyOf[0]).toEqual({ type: 'string' });
    expect(schema.properties.name.anyOf[1]).toEqual({ type: 'null' });
  });

  it('should remove nullable property from schemas', () => {
    const input = {
      openapi: '3.1.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: {},
      components: {
        schemas: {
          TestSchema: {
            type: 'object',
            properties: {
              age: {
                anyOf: [{ type: 'number', nullable: true }],
              },
            },
          },
        },
      },
    } as unknown as OpenAPIV3_1.Document;

    const result = transformOpenAPIDocument(input);
    const schema = result.components?.schemas?.TestSchema as OpenAPI30Schema;

    // The nullable property should be removed
    expect(schema.properties.age.anyOf[0]).not.toHaveProperty('nullable');
    expect(schema.properties.age.anyOf[0]).toEqual({ type: 'number' });
  });

  it('should handle multiple anyOf items with nullable', () => {
    const input = {
      openapi: '3.1.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: {},
      components: {
        schemas: {
          TestSchema: {
            type: 'object',
            properties: {
              value: {
                anyOf: [
                  { type: 'string', nullable: true },
                  { type: 'number', nullable: true },
                ],
              },
            },
          },
        },
      },
    } as unknown as OpenAPIV3_1.Document;

    const result = transformOpenAPIDocument(input);
    const schema = result.components?.schemas?.TestSchema as OpenAPI30Schema;

    expect(schema.properties.value.anyOf).toHaveLength(3);
    expect(schema.properties.value.anyOf[0]).toEqual({ type: 'string' });
    expect(schema.properties.value.anyOf[1]).toEqual({ type: 'number' });
    expect(schema.properties.value.anyOf[2]).toEqual({ type: 'null' });
  });

  it('should handle anyOf without nullable', () => {
    const input = {
      openapi: '3.1.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: {},
      components: {
        schemas: {
          TestSchema: {
            type: 'object',
            properties: {
              value: {
                anyOf: [{ type: 'string' }, { type: 'number' }],
              },
            },
          },
        },
      },
    } as unknown as OpenAPIV3_1.Document;

    const result = transformOpenAPIDocument(input);
    const schema = result.components?.schemas?.TestSchema as OpenAPI30Schema;

    // Should remain unchanged
    expect(schema.properties.value.anyOf).toHaveLength(2);
    expect(schema.properties.value.anyOf[0]).toEqual({ type: 'string' });
    expect(schema.properties.value.anyOf[1]).toEqual({ type: 'number' });
  });

  it('should handle nested objects with nullable properties', () => {
    const input = {
      openapi: '3.1.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: {},
      components: {
        schemas: {
          TestSchema: {
            type: 'object',
            properties: {
              nested: {
                type: 'object',
                properties: {
                  field: {
                    anyOf: [{ type: 'string', nullable: true }],
                  },
                },
              },
            },
          },
        },
      },
    } as unknown as OpenAPIV3_1.Document;

    const result = transformOpenAPIDocument(input);
    const schema = result.components?.schemas?.TestSchema as OpenAPI30Schema;

    expect(schema.properties.nested.properties.field.anyOf).toHaveLength(2);
    expect(schema.properties.nested.properties.field.anyOf[0]).toEqual({ type: 'string' });
    expect(schema.properties.nested.properties.field.anyOf[1]).toEqual({ type: 'null' });
  });

  it('should handle arrays with items containing nullable', () => {
    const input = {
      openapi: '3.1.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: {},
      components: {
        schemas: {
          TestSchema: {
            type: 'object',
            properties: {
              items: {
                type: 'array',
                items: {
                  anyOf: [{ type: 'string', nullable: true }],
                },
              },
            },
          },
        },
      },
    } as unknown as OpenAPIV3_1.Document;

    const result = transformOpenAPIDocument(input);
    const schema = result.components?.schemas?.TestSchema as OpenAPI30Schema;

    expect(schema.properties.items.items.anyOf).toHaveLength(2);
    expect(schema.properties.items.items.anyOf[0]).toEqual({ type: 'string' });
    expect(schema.properties.items.items.anyOf[1]).toEqual({ type: 'null' });
  });

  it('should handle allOf with nested nullable properties', () => {
    const input = {
      openapi: '3.1.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: {},
      components: {
        schemas: {
          TestSchema: {
            allOf: [
              {
                type: 'object',
                properties: {
                  field: {
                    anyOf: [{ type: 'string', nullable: true }],
                  },
                },
              },
            ],
          },
        },
      },
    } as unknown as OpenAPIV3_1.Document;

    const result = transformOpenAPIDocument(input);
    const schema = result.components?.schemas?.TestSchema as OpenAPI30Schema;

    expect(schema.allOf[0].properties.field.anyOf).toHaveLength(2);
    expect(schema.allOf[0].properties.field.anyOf[0]).toEqual({ type: 'string' });
    expect(schema.allOf[0].properties.field.anyOf[1]).toEqual({ type: 'null' });
  });

  it('should preserve other schema properties', () => {
    const input = {
      openapi: '3.1.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: {},
      components: {
        schemas: {
          TestSchema: {
            type: 'object',
            required: ['name'],
            properties: {
              name: {
                anyOf: [{ type: 'string', nullable: true, minLength: 1, maxLength: 100 }],
                description: 'The name field',
              },
            },
          },
        },
      },
    } as unknown as OpenAPIV3_1.Document;

    const result = transformOpenAPIDocument(input);
    const schema = result.components?.schemas?.TestSchema as OpenAPI30Schema;

    // Check that other properties are preserved
    expect(schema.type).toBe('object');
    expect(schema.required).toEqual(['name']);
    expect(schema.properties.name.description).toBe('The name field');
    expect(schema.properties.name.anyOf[0]).toEqual({
      type: 'string',
      minLength: 1,
      maxLength: 100,
    });
  });

  it('should handle paths with nullable request/response schemas', () => {
    const input = {
      openapi: '3.1.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: {
        '/test': {
          get: {
            responses: {
              '200': {
                description: 'Success',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        data: {
                          anyOf: [{ type: 'string', nullable: true }],
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    } as unknown as OpenAPIV3_1.Document;

    const result = transformOpenAPIDocument(input);
    const responseSchema = (result.paths?.['/test'] as OpenAPI30Schema)?.get?.responses?.['200']
      ?.content?.['application/json']?.schema;

    expect(responseSchema.properties.data.anyOf).toHaveLength(2);
    expect(responseSchema.properties.data.anyOf[0]).toEqual({ type: 'string' });
    expect(responseSchema.properties.data.anyOf[1]).toEqual({ type: 'null' });
  });
});
