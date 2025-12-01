import type { EachToken, IfToken, InferredType, Token, VariableToken } from './types.js';

/**
 * Extracts and infers TypeScript types from template tokens.
 * Analyzes variable usage to build a context interface.
 */
export function extractTypes(tokens: Token[]): Map<string, InferredType> {
  const types = new Map<string, InferredType>();
  const loopContext: Array<{ itemName: string; indexName?: string; arrayPath: string }> = [];

  for (const token of tokens) {
    switch (token.type) {
      case 'variable':
        processVariable(token, types, loopContext);
        break;
      case 'if':
      case 'elseif':
        processCondition(token, types, loopContext);
        break;
      case 'each':
        processEachStart(token, types);
        loopContext.push({
          itemName: token.itemName,
          indexName: token.indexName,
          arrayPath: token.arrayPath,
        });
        break;
      case 'end':
        // Check if we're ending a loop
        if (loopContext.length > 0) {
          const lastLoop = loopContext[loopContext.length - 1];
          // Only pop if the last context item was a loop
          // We need smarter tracking for nested if/each, but for spike this works
          loopContext.pop();
        }
        break;
    }
  }

  return types;
}

function processVariable(
  token: VariableToken,
  types: Map<string, InferredType>,
  loopContext: Array<{ itemName: string; indexName?: string; arrayPath: string }>
): void {
  const path = token.path;
  if (path.length === 0) return;

  const rootName = path[0];

  // Skip loop context variables (@index, @first, @last, @length)
  if (rootName.startsWith('@')) {
    return;
  }

  // Check if this is a loop item reference
  const loopCtx = loopContext.find(
    (ctx) => ctx.itemName === rootName || ctx.indexName === rootName
  );

  if (loopCtx && rootName === loopCtx.itemName) {
    // This is accessing a loop item - add properties to the item type
    addLoopItemProperty(loopCtx.arrayPath, path.slice(1), types, token);
    return;
  }

  if (loopCtx && rootName === loopCtx.indexName) {
    // Index is always a number, no need to track
    return;
  }

  // Regular variable access
  addNestedType(path, types, token.defaultValue !== undefined);
}

function addLoopItemProperty(
  arrayPath: string,
  propertyPath: string[],
  types: Map<string, InferredType>,
  token: VariableToken
): void {
  const arrayPathParts = arrayPath.split('.');
  const rootName = arrayPathParts[0];

  // Ensure the array exists in types
  if (!types.has(rootName)) {
    types.set(rootName, {
      name: rootName,
      type: 'array',
      optional: false,
      itemType: { name: 'item', type: 'object', optional: false, properties: {} },
    });
  }

  const rootType = types.get(rootName)!;

  // Navigate to the array type
  let currentType = rootType;
  for (let i = 1; i < arrayPathParts.length; i++) {
    if (!currentType.properties) {
      currentType.properties = {};
    }
    const propName = arrayPathParts[i];
    if (!currentType.properties[propName]) {
      currentType.properties[propName] = {
        name: propName,
        type: 'array',
        optional: false,
        itemType: { name: 'item', type: 'object', optional: false, properties: {} },
      };
    }
    currentType = currentType.properties[propName];
  }

  // Ensure it's an array type
  if (currentType.type !== 'array') {
    currentType.type = 'array';
    currentType.itemType = { name: 'item', type: 'object', optional: false, properties: {} };
  }

  // Add properties to the item type
  if (propertyPath.length > 0 && currentType.itemType) {
    let itemType = currentType.itemType;
    for (let i = 0; i < propertyPath.length; i++) {
      const propName = propertyPath[i];
      if (!itemType.properties) {
        itemType.properties = {};
      }
      if (i === propertyPath.length - 1) {
        // Last property - set type based on token
        if (!itemType.properties[propName]) {
          itemType.properties[propName] = {
            name: propName,
            type: 'string',
            optional: token.defaultValue !== undefined,
          };
        }
      } else {
        // Intermediate property - ensure it exists as object
        if (!itemType.properties[propName]) {
          itemType.properties[propName] = {
            name: propName,
            type: 'object',
            optional: false,
            properties: {},
          };
        }
        itemType = itemType.properties[propName];
      }
    }
  }
}

function addNestedType(
  path: string[],
  types: Map<string, InferredType>,
  isOptional: boolean
): void {
  const rootName = path[0];

  if (!types.has(rootName)) {
    types.set(rootName, {
      name: rootName,
      type: path.length > 1 ? 'object' : 'string',
      optional: isOptional,
      properties: path.length > 1 ? {} : undefined,
    });
  }

  const rootType = types.get(rootName)!;

  if (path.length === 1) {
    return;
  }

  // Navigate and create nested properties
  let currentType = rootType;
  for (let i = 1; i < path.length; i++) {
    const propName = path[i];
    if (!currentType.properties) {
      currentType.properties = {};
      currentType.type = 'object';
    }

    if (i === path.length - 1) {
      // Last property
      if (!currentType.properties[propName]) {
        currentType.properties[propName] = {
          name: propName,
          type: 'string',
          optional: isOptional,
        };
      }
    } else {
      // Intermediate property
      if (!currentType.properties[propName]) {
        currentType.properties[propName] = {
          name: propName,
          type: 'object',
          optional: false,
          properties: {},
        };
      }
      currentType = currentType.properties[propName];
    }
  }
}

function processCondition(
  token: IfToken | { type: 'elseif'; condition: string },
  types: Map<string, InferredType>,
  loopContext: Array<{ itemName: string; indexName?: string; arrayPath: string }>
): void {
  const condition = token.condition;

  // Extract variable references from condition
  // Simple patterns: varName, varName.prop, !varName, varName && otherVar
  const varPattern = /\b([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*)\b/g;
  let match: RegExpExecArray | null;

  while ((match = varPattern.exec(condition)) !== null) {
    const varPath = match[1];

    // Skip JS keywords and operators
    if (['true', 'false', 'null', 'undefined', 'length'].includes(varPath)) {
      continue;
    }

    const path = varPath.split('.');

    // Skip loop context variables
    const rootName = path[0];
    if (rootName.startsWith('@')) continue;
    const loopCtx = loopContext.find(
      (ctx) => ctx.itemName === rootName || ctx.indexName === rootName
    );
    if (loopCtx) {
      // Handle loop item property access in conditions
      if (rootName === loopCtx.itemName && path.length > 1) {
        addLoopItemProperty(loopCtx.arrayPath, path.slice(1), types, {
          type: 'variable',
          raw: '',
          start: 0,
          end: 0,
          expression: varPath,
          path,
        });
      }
      continue;
    }

    addNestedType(path, types, false);
  }
}

function processEachStart(token: EachToken, types: Map<string, InferredType>): void {
  const arrayPath = token.arrayPath.split('.');
  const rootName = arrayPath[0];

  if (!types.has(rootName)) {
    types.set(rootName, {
      name: rootName,
      type: arrayPath.length > 1 ? 'object' : 'array',
      optional: false,
      properties: arrayPath.length > 1 ? {} : undefined,
      itemType:
        arrayPath.length === 1
          ? { name: 'item', type: 'object', optional: false, properties: {} }
          : undefined,
    });
  }

  // If it's a nested path, navigate and ensure array type at the end
  if (arrayPath.length > 1) {
    const rootType = types.get(rootName)!;
    let currentType = rootType;

    for (let i = 1; i < arrayPath.length; i++) {
      const propName = arrayPath[i];
      if (!currentType.properties) {
        currentType.properties = {};
      }

      if (!currentType.properties[propName]) {
        currentType.properties[propName] = {
          name: propName,
          type: i === arrayPath.length - 1 ? 'array' : 'object',
          optional: false,
          properties: i === arrayPath.length - 1 ? undefined : {},
          itemType:
            i === arrayPath.length - 1
              ? { name: 'item', type: 'object', optional: false, properties: {} }
              : undefined,
        };
      }
      currentType = currentType.properties[propName];
    }
  }
}

/**
 * Generates a TypeScript interface from extracted types
 */
export function generateInterface(name: string, types: Map<string, InferredType>): string {
  const lines: string[] = [`export interface ${name} {`];

  for (const [, type] of types) {
    lines.push(...generateProperty(type, 1));
  }

  lines.push('}');
  return lines.join('\n');
}

function generateProperty(type: InferredType, indent: number): string[] {
  const prefix = '  '.repeat(indent);
  const optional = type.optional ? '?' : '';
  const lines: string[] = [];

  if (type.type === 'array' && type.itemType) {
    if (type.itemType.type === 'object' && type.itemType.properties) {
      lines.push(`${prefix}${type.name}${optional}: Array<{`);
      for (const [, prop] of Object.entries(type.itemType.properties)) {
        lines.push(...generateProperty(prop, indent + 1));
      }
      lines.push(`${prefix}}>;`);
    } else {
      lines.push(`${prefix}${type.name}${optional}: ${type.itemType.type}[];`);
    }
  } else if (type.type === 'object' && type.properties) {
    lines.push(`${prefix}${type.name}${optional}: {`);
    for (const [, prop] of Object.entries(type.properties)) {
      lines.push(...generateProperty(prop, indent + 1));
    }
    lines.push(`${prefix}};`);
  } else {
    lines.push(`${prefix}${type.name}${optional}: ${type.type};`);
  }

  return lines;
}
