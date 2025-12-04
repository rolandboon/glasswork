import {
  DeleteCommand,
  type DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { describe, expect, it } from 'vitest';
import { createDynamoDBSessionAdapter } from '../../src/auth/dynamodb-session-adapter.js';

class StubDocumentClient {
  calls: unknown[] = [];
  responses: Record<string, unknown>;

  constructor(responses: Record<string, unknown> = {}) {
    this.responses = responses;
  }

  async send(command: unknown) {
    this.calls.push(command);
    const name = (command as { constructor: { name: string } }).constructor.name;
    return this.responses[name] ?? {};
  }
}

describe('createDynamoDBSessionAdapter', () => {
  it('creates session with correct payload', async () => {
    const client = new StubDocumentClient();
    const adapter = createDynamoDBSessionAdapter({
      tableName: 'sessions',
      documentClient: client as unknown as DynamoDBDocumentClient,
    });

    const expiresAt = new Date(Date.now() + 1_000);
    await adapter.createSession({
      id: 'sess-1',
      userId: 'user-1',
      expiresAt,
      data: { foo: 'bar' },
    });

    const put = client.calls[0] as PutCommand;
    expect(put).toBeInstanceOf(PutCommand);
    // @ts-expect-error - PutCommand has input at runtime
    expect(put.input.TableName).toBe('sessions');
    // @ts-expect-error - PutCommand has input at runtime
    expect(put.input.Item.pk).toBe('sess-1');
    // @ts-expect-error - PutCommand has input at runtime
    expect(put.input.Item.data).toBe(JSON.stringify({ foo: 'bar' }));
  });

  it('returns null for expired sessions', async () => {
    const expiresAt = Math.floor((Date.now() - 1_000) / 1000);
    const createdAt = new Date().toISOString();
    const client = new StubDocumentClient({
      GetCommand: {
        Item: { pk: 'sess-1', userId: 'user-1', expiresAt, data: '{}', createdAt },
      },
    });

    const adapter = createDynamoDBSessionAdapter({
      tableName: 'sessions',
      documentClient: client as unknown as DynamoDBDocumentClient,
    });

    const result = await adapter.getSession('sess-1');
    expect(result).toBeNull();
  });

  it('maps session from DynamoDB', async () => {
    const expiresAt = Math.floor((Date.now() + 10_000) / 1000);
    const createdAt = new Date().toISOString();
    const client = new StubDocumentClient({
      GetCommand: {
        Item: {
          pk: 'sess-2',
          userId: 'user-2',
          expiresAt,
          data: '{"hello":true}',
          createdAt,
          lastAccessedAt: createdAt,
        },
      },
    });

    const adapter = createDynamoDBSessionAdapter({
      tableName: 'sessions',
      documentClient: client as unknown as DynamoDBDocumentClient,
    });

    const result = await adapter.getSession('sess-2');
    expect(result?.id).toBe('sess-2');
    expect(result?.expiresAt).toBeInstanceOf(Date);
    expect(result?.data?.hello).toBe(true);
    expect(result?.lastAccessedAt).toBeInstanceOf(Date);
  });

  it('updates and deletes sessions', async () => {
    const client = new StubDocumentClient();
    const adapter = createDynamoDBSessionAdapter({
      tableName: 'sessions',
      documentClient: client as unknown as DynamoDBDocumentClient,
    });

    const expiresAt = new Date(Date.now() + 5_000);
    await adapter.updateSession('sess-3', { expiresAt, data: { foo: 'bar' } });

    const update = client.calls.at(-1) as UpdateCommand;
    expect(update).toBeInstanceOf(UpdateCommand);
    // @ts-expect-error - UpdateCommand has input at runtime
    expect(update.input.ExpressionAttributeValues?.[':data']).toBe(JSON.stringify({ foo: 'bar' }));

    await adapter.deleteSession('sess-3');
    const del = client.calls.at(-1) as DeleteCommand;
    expect(del).toBeInstanceOf(DeleteCommand);
    // @ts-expect-error - DeleteCommand has input at runtime
    expect(del.input.Key).toEqual({ pk: 'sess-3' });
  });
});
