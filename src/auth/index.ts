export {
  createAbilityFactory,
  defineRoleAbilities,
  type InferAbility,
} from './abilities.js';
export { assertCan, can, subject } from './assert.js';
export {
  type BetterAuthClient,
  type BetterAuthProviderConfig,
  createBetterAuthProvider,
} from './better-auth-provider.js';
export {
  createDynamoDBSessionAdapter,
  type DynamoDBSessionConfig,
  type DynamoDBSessionRecord,
} from './dynamodb-session-adapter.js';
export {
  type AuthMiddlewareConfig,
  createAuthMiddleware,
} from './middleware.js';
export type { AuthContext, AuthProvider, AuthSession, AuthUser } from './types.js';
