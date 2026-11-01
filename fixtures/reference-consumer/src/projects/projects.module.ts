import { randomUUID } from 'node:crypto';
import type { AuthContext } from 'glasswork/auth';
import { defineModule } from 'glasswork/core';
import { createRoutes } from 'glasswork/http';
import { createRLSMiddleware } from 'glasswork/rls';
import * as v from 'valibot';
import { type AppUser, AuthModule } from '../platform/auth.module.js';
import { type Database, DatabaseModule } from '../platform/database.module.js';
import type { AuthMiddlewareFactory } from '../platform/types.js';

export const ProjectDto = v.object({ id: v.string(), name: v.string(), createdAt: v.string() });
const CreateProjectDto = v.object({ name: v.pipe(v.string(), v.minLength(1)) });
const SummaryDto = v.object({ authenticated: v.boolean(), projects: v.number() });

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
