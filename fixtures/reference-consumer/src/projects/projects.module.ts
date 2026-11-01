import { randomUUID } from 'node:crypto';
import type { AuthContext } from 'glasswork/auth';
import { defineModule } from 'glasswork/core';
import {
  BadRequestException,
  createRoutes,
  NotFoundException,
  PreconditionFailedException,
} from 'glasswork/http';
import { createRLSMiddleware } from 'glasswork/rls';
import { HTTPException } from 'hono/http-exception';
import * as v from 'valibot';
import { type AppUser, type AuthMiddlewareFactory, AuthModule } from '../platform/auth.module.js';
import { type Database, DatabaseModule } from '../platform/database.module.js';

export const ProjectDto = v.object({
  id: v.string(),
  name: v.string(),
  version: v.number(),
  createdAt: v.string(),
});
const CreateProjectDto = v.object({ name: v.pipe(v.string(), v.minLength(1)) });
const SummaryDto = v.object({ authenticated: v.boolean(), projects: v.number() });
const ProjectParams = v.object({ id: v.string() });

/** A strong ETag for a version: `"3"`. */
export function etag(version: number) {
  return `"${version}"`;
}

/** The version in an If-Match header. A missing header is 428, an unknown format 400. */
export function versionFromIfMatch(header: string | undefined): number {
  if (header === undefined) {
    throw new HTTPException(428, { message: 'Send If-Match with the ETag you last read' });
  }
  const match = /^"(\d+)"$/.exec(header.trim());
  if (!match) throw new BadRequestException('If-Match must be an ETag from this API');
  const version = Number(match[1]);
  if (!Number.isSafeInteger(version) || version < 1 || version > 2_147_483_647) {
    throw new BadRequestException('If-Match must contain a positive PostgreSQL integer version');
  }
  return version;
}

/** Reads and writes the projects of the tenant bound to the current request. */
export class ProjectsService {
  readonly #prisma: Database;

  constructor({ prisma }: { prisma: Database }) {
    this.#prisma = prisma;
  }

  list() {
    return this.#prisma.project.findMany({ orderBy: { createdAt: 'asc' } });
  }

  count() {
    return this.#prisma.project.count();
  }

  create(tenantId: string, name: string) {
    return this.#prisma.project.create({ data: { id: randomUUID(), tenantId, name } });
  }

  find(id: string) {
    return this.#prisma.project.findFirst({ where: { id } });
  }

  /**
   * Renames the project only while it still has the version the client read, and counts
   * the version up in the same statement. Two writers from one version cannot both win.
   */
  async rename(id: string, name: string, expectedVersion: number) {
    try {
      return await this.#prisma.project.update({
        where: { id, version: expectedVersion },
        data: { name, version: { increment: 1 } },
      });
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2025') throw error;
      if (await this.find(id)) {
        throw new PreconditionFailedException('The project changed since you read it');
      }
      throw new NotFoundException('Project not found');
    }
  }
}

interface ProjectServices {
  projectsService: ProjectsService;
  requireAuth: AuthMiddlewareFactory;
  optionalAuth: AuthMiddlewareFactory;
}

const projectRoutes = createRoutes<ProjectServices, AuthContext<AppUser>>(
  (router, services, route) => {
    const tenant = createRLSMiddleware();

    router.get(
      '/summary',
      ...route({
        operationId: 'getProjectSummary',
        summary: 'Count projects; open to guests',
        public: true,
        middleware: [services.optionalAuth(), tenant],
        responses: { 200: SummaryDto },
        handler: async ({ user }) => ({
          authenticated: Boolean(user),
          projects: user ? await services.projectsService.count() : 0,
        }),
      })
    );

    router.get(
      '/',
      ...route({
        operationId: 'listProjects',
        summary: 'List projects',
        middleware: [services.requireAuth(), tenant],
        authorize: { action: 'read', subject: 'Project' },
        responses: { 200: v.array(ProjectDto) },
        handler: () => services.projectsService.list(),
      })
    );

    router.get(
      '/:id',
      ...route({
        operationId: 'getProject',
        summary: 'Show a project; the ETag header carries its version',
        middleware: [services.requireAuth(), tenant],
        params: ProjectParams,
        responses: { 200: ProjectDto },
        handler: async ({ params, context }) => {
          const project = await services.projectsService.find(params.id);
          if (!project) throw new NotFoundException('Project not found');
          context.header('ETag', etag(project.version));
          return project;
        },
      })
    );

    router.patch(
      '/:id',
      ...route({
        operationId: 'renameProject',
        summary: 'Rename a project unless it changed since the client read it',
        middleware: [services.requireAuth(), tenant],
        params: ProjectParams,
        body: CreateProjectDto,
        responses: { 200: ProjectDto },
        openapi: {
          parameters: [
            {
              name: 'If-Match',
              in: 'header',
              required: true,
              description:
                'The ETag of the version this change is based on. A newer version answers 412: read the project again and decide what to keep.',
              schema: { type: 'string' },
            },
          ],
        },
        handler: async ({ params, body, context }) => {
          const expected = versionFromIfMatch(context.req.header('if-match'));
          const project = await services.projectsService.rename(params.id, body.name, expected);
          context.header('ETag', etag(project.version));
          return project;
        },
      })
    );

    router.post(
      '/',
      ...route({
        operationId: 'createProject',
        summary: 'Create a project',
        middleware: [services.requireAuth(), tenant],
        // Rejects guests before the handler runs, so `user` is typed as non-null.
        authorize: { action: 'create', subject: 'Project' },
        body: CreateProjectDto,
        responses: { 201: ProjectDto },
        handler: ({ body, user }) => services.projectsService.create(user.tenantId, body.name),
      })
    );
  }
);

export const ProjectsModule = defineModule({
  name: 'projects',
  basePath: 'projects',
  imports: [DatabaseModule, AuthModule],
  providers: [ProjectsService],
  routes: projectRoutes,
});
