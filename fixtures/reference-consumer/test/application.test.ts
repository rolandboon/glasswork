import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { bootstrap } from 'glasswork/core';
import {
  bootstrapWorker,
  InvalidJobPayloadError,
  type JobService,
  SQSQueueDriver,
} from 'glasswork/jobs';
import { AppModule } from '../src/app.module.js';
import { InvitationsModule } from '../src/invitations/invitations.module.js';
import { sendInvitationJob } from '../src/invitations/send-invitation.job.js';
import { outbox } from '../src/platform/email.module.js';
import { createDatabase, request, startApp } from './support.js';

const database = await createDatabase();
after(() => database.drop());

describe('HTTP routes with auth and tenant isolation', () => {
  let application: Awaited<ReturnType<typeof startApp>>;
  before(async () => {
    application = await startApp();
  });
  after(() => application.stop());

  it('lets guests use a public route', async () => {
    const res = await request(application.app, '/projects/summary');

    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { authenticated: false, projects: 0 });
  });

  it('rejects protected routes without a session', async () => {
    assert.equal((await request(application.app, '/projects')).status, 401);
  });

  it('keeps each tenant to its own projects and strips undeclared fields', async () => {
    const created = await request(application.app, '/projects', {
      token: 'alice-token',
      body: { name: 'Annual plan' },
    });
    assert.equal(created.status, 201);

    const alice = (await (
      await request(application.app, '/projects', { token: 'alice-token' })
    ).json()) as Array<Record<string, unknown>>;
    const bob = await (await request(application.app, '/projects', { token: 'bob-token' })).json();

    assert.deepEqual(
      alice.map(({ name }) => name),
      ['Annual plan']
    );
    assert.equal('tenantId' in (alice[0] ?? {}), false);
    assert.deepEqual(bob, []);
  });

  it('enforces an explicit production response contract even when NODE_ENV is test', async () => {
    assert.equal(process.env.NODE_ENV, 'test');
    const production = await bootstrap(AppModule, {
      environment: 'production',
      providerOverrides: [
        {
          provide: 'projectsService',
          useValue: { list: () => [{ id: 123, name: 'invalid', secret: 'private-value' }] },
        },
      ],
    });
    try {
      const response = await request(production.app, '/projects', { token: 'alice-token' });
      assert.equal(response.status, 500);
      assert.equal((await response.text()).includes('private-value'), false);
    } finally {
      await production.stop();
    }
  });

  it('rejects an invalid body with 422', async () => {
    const res = await request(application.app, '/projects', {
      token: 'alice-token',
      body: { name: '' },
    });

    assert.equal(res.status, 422);
  });
});

describe('invitations: transaction, audit and job', () => {
  async function createProject(app: Parameters<typeof request>[0]) {
    const res = await request(app, '/projects', { token: 'alice-token', body: { name: 'Plan' } });
    return ((await res.json()) as { id: string }).id;
  }

  it('commits invitation and audit, then sends through a private service in-process', async () => {
    const application = await startApp();
    try {
      const projectId = await createProject(application.app);

      const res = await request(application.app, '/invitations', {
        token: 'alice-token',
        body: { projectId, email: 'new@example.com' },
      });

      assert.equal(res.status, 202);
      const { id } = (await res.json()) as { id: string };
      const [invitation] = await database.query<{ status: string }>(
        `"Invitation" WHERE id = '${id}'`
      );
      const audit = await database.query(`"AuditLog" WHERE "subjectId" = '${id}'`);
      assert.equal(invitation?.status, 'sent');
      assert.equal(audit.length, 1);
      assert.deepEqual(
        outbox.sentEmails.map((email) => email.message.to),
        ['new@example.com']
      );
    } finally {
      await application.stop();
    }
  });

  it('rolls back the invitation and its audit entry together', async () => {
    const application = await startApp();
    try {
      const auditBefore = (await database.query('"AuditLog"')).length;
      const res = await request(application.app, '/invitations', {
        token: 'alice-token',
        body: { projectId: 'missing', email: 'new@example.com' },
      });

      assert.equal(res.status, 404);
      assert.deepEqual(await database.query(`"Invitation" WHERE "projectId" = 'missing'`), []);
      assert.equal((await database.query('"AuditLog"')).length, auditBefore);
      assert.equal(outbox.sentEmails.length, 0);
    } finally {
      await application.stop();
    }
  });

  it('rolls back a written invitation when recording its audit fails', async () => {
    const application = await startApp([
      {
        provide: 'audit',
        useValue: {
          audit: async () => {
            throw new Error('audit storage unavailable');
          },
        },
      },
    ]);
    try {
      const projectId = await createProject(application.app);
      const before = (await database.query('"AuditLog"')).length;
      const response = await request(application.app, '/invitations', {
        token: 'alice-token',
        body: { projectId, email: 'rollback@example.com' },
      });
      assert.equal(response.status, 500);
      assert.deepEqual(await database.query(`"Invitation" WHERE "projectId" = '${projectId}'`), []);
      assert.equal((await database.query('"AuditLog"')).length, before);
      assert.equal(outbox.sentEmails.length, 0);
    } finally {
      await application.stop();
    }
  });

  it('delivers the same job through SQS serialization and the worker', async () => {
    const sent: Array<{ MessageBody?: string }> = [];
    const sqs = new SQSQueueDriver({
      region: 'eu-west-1',
      queues: { default: 'https://sqs.eu-west-1.amazonaws.com/000000000000/jobs' },
      client: {
        send: async (command: { input: { MessageBody?: string } }) => {
          sent.push(command.input);
          return { MessageId: `message-${sent.length}` };
        },
        destroy: () => {},
      } as never,
    });
    const application = await startApp([{ provide: 'queueDriver', useValue: sqs }]);
    try {
      const projectId = await createProject(application.app);
      const res = await request(application.app, '/invitations', {
        token: 'alice-token',
        body: { projectId, email: 'queued@example.com' },
      });
      const { id } = (await res.json()) as { id: string };
      assert.equal(sent.length, 1);
      assert.equal(outbox.sentEmails.length, 0);

      const worker = bootstrapWorker({ module: AppModule, metrics: { enabled: false } });
      const result = await worker({
        Records: [
          {
            messageId: 'message-1',
            receiptHandle: 'receipt-1',
            body: sent[0]?.MessageBody ?? '',
            attributes: { ApproximateReceiveCount: '1' },
            eventSourceARN: 'arn:aws:sqs:eu-west-1:000000000000:jobs',
            eventSource: 'aws:sqs',
          },
        ],
      } as never);

      assert.deepEqual(result, { batchItemFailures: [] });
      const [invitation] = await database.query<{ status: string }>(
        `"Invitation" WHERE id = '${id}'`
      );
      assert.equal(invitation?.status, 'sent');
      assert.deepEqual(
        outbox.sentEmails.map((email) => email.message.to),
        ['queued@example.com']
      );
    } finally {
      await application.stop();
    }
  });

  it('rejects a payload that would not survive JSON transport', async () => {
    const application = await startApp();
    try {
      const jobService = application.container.resolve('jobService') as JobService;

      await assert.rejects(
        jobService.enqueue(sendInvitationJob, {
          invitationId: 'i',
          tenantId: 'tenant-a',
          version: 1,
          requestedAt: new Date() as unknown as string,
        }),
        InvalidJobPayloadError
      );
    } finally {
      await application.stop();
    }
  });
});

describe('module-focused bootstrap', () => {
  it('composes only the feature module and its imports', async () => {
    const application = await bootstrap(InvitationsModule, { environment: 'test' });
    try {
      assert.equal((await request(application.app, '/projects')).status, 404);
      assert.equal(
        (
          await request(application.app, '/invitations', {
            body: { projectId: 'p', email: 'a@b.c' },
          })
        ).status,
        401
      );
      assert.throws(() => application.container.resolve('projectsService'));
    } finally {
      await application.stop();
    }
  });
});
