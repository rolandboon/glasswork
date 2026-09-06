import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getTenantId, runWithBypass, runWithTenant } from '../../src/rls/context.js';
import { createRLSExtension } from '../../src/rls/extension.js';
import { generateRLSPolicies } from '../../src/rls/generator.js';
import { MissingTenantContextException, RLSConfigurationException } from '../../src/rls/types.js';
import { PrismaClient } from './fixtures/generated/client.js';

const databaseUrl = process.env.RLS_TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)('Prisma RLS with PostgreSQL', () => {
  const schema = `rls_${randomUUID().replaceAll('-', '')}`;
  const role = `${schema}_app`;
  const password = randomUUID();
  const admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const url = new URL(databaseUrl ?? 'postgresql://localhost/test');
  url.username = role;
  url.password = password;
  url.searchParams.set('options', `-c search_path=${schema}`);
  const base = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url.href, max: 2 }, { schema }),
  });
  const client = base.$extends(createRLSExtension({ models: ['Project'] }));
  const bypassClient = base.$extends(
    createRLSExtension({ models: ['Project'], bypassVariable: 'app.bypass' })
  );
  const lenient = base.$extends(
    createRLSExtension({ models: ['Project'], missingContextBehavior: 'ignore' })
  );

  beforeAll(async () => {
    await admin.$executeRawUnsafe(
      `CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS`
    );
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await admin.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path = "${schema}"`);
      await tx.$executeRawUnsafe(
        'CREATE TABLE "Project" (id text PRIMARY KEY, "tenantId" text NOT NULL, name text NOT NULL)'
      );
      await tx.$executeRawUnsafe(
        'CREATE TABLE "GlobalSetting" (id text PRIMARY KEY, value text NOT NULL, "projectId" text REFERENCES "Project"(id))'
      );
      for (const statement of generateRLSPolicies({
        models: ['Project'],
        bypassVariable: 'app.bypass',
      })
        .split(';')
        .filter((value) => value.trim())) {
        await tx.$executeRawUnsafe(statement);
      }
      await tx.$executeRawUnsafe(`GRANT USAGE ON SCHEMA "${schema}" TO "${role}"`);
      await tx.$executeRawUnsafe(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${schema}" TO "${role}"`
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO "Project" VALUES ('a', 'tenant_a', 'A'), ('b', 'tenant_b', 'B')`
      );
      await tx.$executeRawUnsafe(`INSERT INTO "GlobalSetting" VALUES ('global', 'global', 'b')`);
    });
  });

  afterAll(async () => {
    await base.$disconnect();
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.$executeRawUnsafe(`DROP ROLE IF EXISTS "${role}"`);
    await admin.$disconnect();
  });

  it('runs the query on the same connection as the tenant configuration', async () => {
    const projects = await runWithTenant({ tenantId: 'tenant_a' }, () => client.project.findMany());
    expect(projects).toEqual([{ id: 'a', tenantId: 'tenant_a', name: 'A' }]);
  });

  it('binds context inside $withTenant without an external wrapper', async () => {
    const projects = await client.$withTenant({ tenantId: 'tenant_b' }, (tx) =>
      tx.project.findMany()
    );
    expect(projects).toEqual([{ id: 'b', tenantId: 'tenant_b', name: 'B' }]);
  });

  it('guards scoped models and raw queries while allowing global models without context', async () => {
    await expect(client.project.findMany()).rejects.toThrow(MissingTenantContextException);
    expect(await client.$queryRaw`SELECT id FROM "Project"`).toEqual([]);
    expect(await client.globalSetting.count()).toBe(1);
    expect(await lenient.project.findMany()).toEqual([]);
    await expect(lenient.$transaction(async () => undefined)).rejects.toThrow(
      MissingTenantContextException
    );
    const allModels = base.$extends(createRLSExtension());
    await expect(allModels.$queryRaw`SELECT 1`).rejects.toThrow(MissingTenantContextException);
    await expect(allModels.globalSetting.findMany()).rejects.toThrow(MissingTenantContextException);
  });

  it('isolates concurrent tenants and reused pool connections', async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) => {
        const tenantId = index % 2 === 0 ? 'tenant_a' : 'tenant_b';
        return runWithTenant({ tenantId }, async () => {
          const rows = await client.project.findMany();
          expect(rows.map((row) => row.tenantId)).toEqual([tenantId]);
          return rows;
        });
      })
    );
    expect(results).toHaveLength(12);
    expect(await base.project.findMany()).toEqual([]);
    expect(getTenantId()).toBeUndefined();
  });

  it('rejects inserts and tenant changes targeting another tenant', async () => {
    await runWithTenant({ tenantId: 'tenant_a' }, async () => {
      await expect(
        client.project.create({ data: { id: 'invalid', tenantId: 'tenant_b', name: 'invalid' } })
      ).rejects.toThrow();
      await expect(
        client.project.update({ where: { id: 'a' }, data: { tenantId: 'tenant_b' } })
      ).rejects.toThrow();
      expect(
        await client.project.updateMany({ where: { id: 'b' }, data: { name: 'invalid' } })
      ).toEqual({ count: 0 });
      expect(await client.project.deleteMany({ where: { id: 'b' } })).toEqual({ count: 0 });
      expect(await client.project.findUnique({ where: { id: 'b' } })).toBeNull();
    });
  });

  it('supports raw queries inside and outside explicit transactions', async () => {
    await runWithTenant({ tenantId: 'tenant_a' }, async () => {
      expect(await client.$queryRaw`SELECT id FROM "Project"`).toEqual([{ id: 'a' }]);
      expect(await client.$executeRaw`UPDATE "Project" SET name = 'unwanted' WHERE id = 'b'`).toBe(
        0
      );
      await client.$transaction(async (tx) => {
        expect(await tx.$queryRawUnsafe('SELECT id FROM "Project"')).toEqual([{ id: 'a' }]);
        expect(await tx.$executeRawUnsafe('DELETE FROM "Project" WHERE id = $1', 'b')).toBe(0);
      });
    });
  });

  it('rolls back all writes when the callback throws', async () => {
    await expect(
      client.$withTenant({ tenantId: 'tenant_a' }, async (tx) => {
        await tx.project.create({
          data: { id: 'rollback', tenantId: 'tenant_a', name: 'temporary' },
        });
        expect(await tx.project.findUnique({ where: { id: 'rollback' } })).not.toBeNull();
        throw new Error('rollback');
      })
    ).rejects.toThrow('rollback');
    expect(
      await runWithTenant({ tenantId: 'tenant_a' }, () =>
        client.project.findUnique({ where: { id: 'rollback' } })
      )
    ).toBeNull();
  });

  it('commits a callback transaction and passes through the isolation option', async () => {
    await runWithTenant({ tenantId: 'tenant_a' }, async () => {
      const name = await client.$transaction(
        async (tx) => {
          expect(await tx.$queryRaw`SHOW transaction_isolation`).toEqual([
            { transaction_isolation: 'serializable' },
          ]);
          return (
            await tx.project.create({
              data: { id: 'commit', tenantId: 'tenant_a', name: 'saved' },
            })
          ).name;
        },
        { isolationLevel: 'Serializable', timeout: 10000, maxWait: 10000 }
      );
      expect(name).toBe('saved');
      expect(await client.project.delete({ where: { id: 'commit' } })).toMatchObject({ name });
    });
  });

  it('rejects context changes within an open transaction', async () => {
    await client.$withTenant({ tenantId: 'tenant_a' }, async (tx) => {
      await expect(
        runWithTenant({ tenantId: 'tenant_b' }, () => tx.project.findMany())
      ).rejects.toThrow(RLSConfigurationException);
      expect(await tx.project.findMany()).toEqual([{ id: 'a', tenantId: 'tenant_a', name: 'A' }]);
    });
  });

  it('explicitly rejects batch transactions before executing queries', async () => {
    await expect(
      runWithTenant({ tenantId: 'tenant_a' }, () => {
        // @ts-expect-error The array form must also be rejected at compile time.
        return client.$transaction([]);
      })
    ).rejects.toThrow('callback form');
  });

  it('requires explicit bypass configuration and restores tenant isolation afterwards', async () => {
    await expect(runWithBypass(() => client.project.findMany())).rejects.toThrow(
      RLSConfigurationException
    );
    expect(await runWithBypass(() => bypassClient.project.count())).toBe(2);
    expect(await bypassClient.$withTenant({ bypass: true }, (tx) => tx.project.count())).toBe(2);
    expect(await runWithTenant({ tenantId: 'tenant_a' }, () => bypassClient.project.count())).toBe(
      1
    );
    expect(await base.project.count()).toBe(0);
  });

  it('parameterizes tenant values containing SQL characters', async () => {
    expect(
      await runWithTenant({ tenantId: "tenant_a'; SELECT 1; --" }, () => client.project.count())
    ).toBe(0);
    expect(await runWithTenant({ tenantId: 'tenant_a' }, () => client.project.count())).toBe(1);
  });

  it('preserves previously applied Prisma extensions within transactions', async () => {
    const extended = base
      .$extends({
        result: {
          project: {
            label: { needs: { name: true }, compute: (project) => `Project ${project.name}` },
          },
        },
      })
      .$extends(createRLSExtension({ models: ['Project'] }));
    const row = await extended.$withTenant({ tenantId: 'tenant_a' }, (tx) =>
      tx.project.findUniqueOrThrow({ where: { id: 'a' } })
    );
    expect(row.label).toBe('Project A');
  });

  it('applies RLS to relations loaded from a global model', async () => {
    const hidden = await runWithTenant({ tenantId: 'tenant_a' }, () =>
      client.globalSetting.findUniqueOrThrow({
        where: { id: 'global' },
        include: { project: true },
      })
    );
    expect(hidden.project).toBeNull();
    const visible = await runWithTenant({ tenantId: 'tenant_b' }, () =>
      client.globalSetting.findUniqueOrThrow({
        where: { id: 'global' },
        include: { project: true },
      })
    );
    expect(visible.project).toEqual({ id: 'b', tenantId: 'tenant_b', name: 'B' });
  });

  it('rejects nested writes to another tenant from a global model', async () => {
    await expect(
      runWithTenant({ tenantId: 'tenant_a' }, () =>
        client.globalSetting.create({
          data: {
            id: 'nested_invalid',
            value: 'unwanted',
            project: { create: { id: 'nested_invalid', tenantId: 'tenant_b', name: 'unwanted' } },
          },
        })
      )
    ).rejects.toThrow();
    expect(await client.globalSetting.findUnique({ where: { id: 'nested_invalid' } })).toBeNull();
  });

  it('supports nested writes with explicit tenant fields', async () => {
    await client.$withTenant({ tenantId: 'tenant_a' }, async (tx) => {
      const row = await tx.globalSetting.create({
        data: {
          id: 'nested_valid',
          value: 'allowed',
          project: { create: { id: 'nested_valid', tenantId: 'tenant_a', name: 'allowed' } },
        },
        include: { project: true },
      });
      expect(row.project?.tenantId).toBe('tenant_a');
      await tx.globalSetting.delete({ where: { id: row.id } });
      await tx.project.delete({ where: { id: 'nested_valid' } });
    });
  });
});
