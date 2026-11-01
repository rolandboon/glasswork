// Compiled against the client generated from openapi.json. A removed or renamed response
// field fails this typecheck, before any frontend uses it.
import type {
  CreateInvitationResponses,
  ErrorResponse,
  ListProjectsResponses,
  ValidationErrorResponse,
} from './client/types.gen.js';

type Project = ListProjectsResponses[200][number];
type Invitation = CreateInvitationResponses[202];

export function describeProject(project: Project): string {
  return `${project.id}: ${project.name} (${project.createdAt})`;
}

export function describeInvitation(invitation: Invitation): string {
  return `${invitation.id} for ${invitation.projectId} is ${invitation.status}`;
}

/** Error codes and field paths must also survive OpenAPI generation. */
export function describeError(error: ErrorResponse | ValidationErrorResponse): string {
  const fields =
    'issues' in error ? error.issues.map((issue) => issue.path.join('.')).join(', ') : '';
  return `${error.code}: ${fields || error.error}`;
}
