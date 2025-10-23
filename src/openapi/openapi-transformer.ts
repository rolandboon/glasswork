import type { OpenAPIV3_1 } from 'openapi-types';

/**
 * Checks if an array of anyOf/oneOf items contains a schema with nullable: true
 */
function hasNullableSchema(items: unknown[]): boolean {
  return items.some(
    (item) =>
      typeof item === 'object' && item !== null && 'nullable' in item && item.nullable === true
  );
}

/**
 * Removes the nullable property from a schema object
 */
function removeNullableProperty(item: unknown): unknown {
  if (typeof item !== 'object' || item === null) {
    return item;
  }
  const { ...rest } = item as Record<string, unknown>;
  delete rest.nullable;
  return rest;
}

/**
 * Transforms an anyOf array that contains nullable schemas to include explicit null type
 */
function transformAnyOfWithNullable(items: unknown[]): unknown[] {
  const transformed = items.map(removeNullableProperty).filter((item) => {
    if (typeof item !== 'object' || item === null) {
      return true;
    }
    return Object.keys(item).length > 0;
  });
  transformed.push({ type: 'null' });
  return transformed;
}

/**
 * Transforms a single key-value pair in a schema object
 */
function transformSchemaProperty(key: string, value: unknown): unknown {
  if (key === 'anyOf' && Array.isArray(value)) {
    if (hasNullableSchema(value)) {
      return transformAnyOfWithNullable(value).map(transformNullable);
    }
    return transformNullable(value);
  }
  if (key === 'allOf' || key === 'oneOf' || key === 'properties' || key === 'items') {
    return transformNullable(value);
  }
  return transformNullable(value);
}

/**
 * Transforms OpenAPI 3.0-style nullable syntax to OpenAPI 3.1.0-compatible format
 *
 * Converts patterns like:
 *   {"anyOf": [{"type": "string", "nullable": true}]}
 * To:
 *   {"anyOf": [{"type": "string"}, {"type": "null"}]}
 *
 * @param schema - OpenAPI schema to transform
 * @returns Transformed schema with OpenAPI 3.1.0-compatible nullable syntax
 */
function transformNullable(schema: unknown): unknown {
  if (schema === null || schema === undefined || typeof schema !== 'object') {
    return schema;
  }
  if (Array.isArray(schema)) {
    return schema.map(transformNullable);
  }
  const obj = schema as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'nullable' && value === true) {
      continue;
    }
    result[key] = transformSchemaProperty(key, value);
  }
  return result;
}

/**
 * Transforms an OpenAPI document to ensure OpenAPI 3.1.0 compatibility
 *
 * This function:
 * - Converts OpenAPI 3.0-style nullable syntax to OpenAPI 3.1.0 format
 * - Recursively processes all schemas in components, paths, and responses
 *
 * @param doc - OpenAPI document to transform
 * @returns Transformed OpenAPI document
 */
export function transformOpenAPIDocument(doc: OpenAPIV3_1.Document): OpenAPIV3_1.Document {
  return transformNullable(doc) as OpenAPIV3_1.Document;
}
