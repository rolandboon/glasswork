import { customAlphabet } from 'nanoid';
import { BadRequestException, ForbiddenException } from '../http/errors.js';

// ============================================================================
// Constants
// ============================================================================

const UPLOAD_RANDOM_ID_LENGTH = 16;
const MAX_PATH_LENGTH = 1024;
const NANOID_ALPHABET = '1234567890abcdef';

// ============================================================================
// Type Definitions
// ============================================================================

export interface UploadPathConfig {
  /** Directory path for the file (e.g., 'uploads/avatars/user123/abc123') */
  readonly dir: string;
  /** Sanitized file name (e.g., 'photo.jpg') */
  readonly fileName: string;
}

// ============================================================================
// Upload Configuration
// ============================================================================

/**
 * Creates an upload configuration object for presigned URL generation.
 * Validates IDs and generates a unique random folder to prevent overwrites.
 *
 * @param prefix - Upload folder prefix (e.g., 'avatars', 'documents')
 * @param ids - Array of IDs to include in path (e.g., [userId] or [clientId, orderId])
 * @param fileName - Sanitized filename (validate with sanitizedFileName schema first)
 * @returns Configuration object with dir and fileName properties
 * @throws BadRequestException if prefix is empty or IDs contain invalid characters
 *
 * @example
 * ```typescript
 * // In route handler:
 * const config = createUploadConfig('avatars', [user.id], query.name);
 * const result = await uploadsService.getSignedUploadUrl(config);
 * // Result path: /uploads/avatars/{userId}/{randomId}/{filename}
 * ```
 */
export function createUploadConfig(
  prefix: string,
  ids: readonly string[],
  fileName: string
): UploadPathConfig {
  if (!prefix || prefix.trim() === '') {
    throw new BadRequestException('Prefix cannot be empty');
  }
  for (const id of ids) {
    if (!id || typeof id !== 'string') {
      throw new BadRequestException(`Invalid ID: ${id}`);
    }
    if (id.includes('/') || id.includes('\\') || id.includes('..')) {
      throw new BadRequestException(`Invalid character in ID: ${id}`);
    }
  }
  /*
   * Handle empty IDs array gracefully to avoid double slashes.
   * If ids are present, join them with '/', otherwise use empty string.
   */
  const idPath = ids.length > 0 ? `${ids.join('/')}/` : '';
  const randomId = customAlphabet(NANOID_ALPHABET, UPLOAD_RANDOM_ID_LENGTH)();
  const dir = `uploads/${prefix}/${idPath}${randomId}`;
  return { dir, fileName };
}

// ============================================================================
// Path Ownership Validation
// ============================================================================

/**
 * Validate IDs don't contain path traversal characters.
 */
function validateIdsForPath(ids: readonly string[], errorMessage: string): void {
  for (const id of ids) {
    if (!id || typeof id !== 'string') {
      throw new ForbiddenException(errorMessage);
    }
    if (id.includes('/') || id.includes('\\') || id.includes('..')) {
      throw new ForbiddenException(errorMessage);
    }
  }
}

/**
 * Check if path contains control characters (security measure).
 */
function hasControlCharacters(path: string): boolean {
  for (let i = 0; i < path.length; i++) {
    const code = path.charCodeAt(i);
    if ((code >= 0x00 && code <= 0x1f) || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/**
 * Decode and normalize path, rejecting traversal attempts.
 */
function decodeAndNormalizePath(path: string, errorMessage: string): string {
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(path);
  } catch {
    throw new ForbiddenException(errorMessage);
  }
  if (decodedPath.includes('..') || decodedPath.includes('./') || decodedPath.includes('.\\')) {
    throw new ForbiddenException(errorMessage);
  }
  if (decodedPath.includes('\\')) {
    throw new ForbiddenException(errorMessage);
  }
  const normalizedPath = decodedPath.replace(/\/+/g, '/');
  if (normalizedPath !== decodedPath) {
    throw new ForbiddenException(errorMessage);
  }
  return normalizedPath;
}

/**
 * Validate relative path has a valid filename at the end.
 */
function validateRelativePath(relativePath: string, errorMessage: string): void {
  if (relativePath === '' || relativePath.endsWith('/')) {
    throw new ForbiddenException(errorMessage);
  }
  const lastSlashIndex = relativePath.lastIndexOf('/');
  const filename = lastSlashIndex >= 0 ? relativePath.slice(lastSlashIndex + 1) : relativePath;
  if (!filename || filename.trim() === '') {
    throw new ForbiddenException(errorMessage);
  }
}

/**
 * Asserts that a file path belongs to the specified prefix and IDs.
 * Use this to validate delete operations - ensures users can only delete their own files.
 *
 * @param path - The file path to validate (e.g., from query.name)
 * @param prefix - The expected upload prefix (e.g., 'avatars', 'documents')
 * @param ids - The expected IDs in the path
 * @param errorMessage - Custom error message (default: 'Invalid file path')
 * @throws ForbiddenException if path doesn't match expected structure
 *
 * @example
 * ```typescript
 * // In delete handler:
 * assertUploadPathOwnership(query.path, 'avatars', [user.id]);
 * await uploadsService.deleteFile(query.path);
 * ```
 */
export function assertUploadPathOwnership(
  path: string,
  prefix: string,
  ids: readonly string[],
  errorMessage = 'Invalid file path'
): void {
  validateIdsForPath(ids, errorMessage);
  if (path.length > MAX_PATH_LENGTH || hasControlCharacters(path)) {
    throw new ForbiddenException(errorMessage);
  }
  const normalizedPath = decodeAndNormalizePath(path, errorMessage);
  const idPath = ids.length > 0 ? `${ids.join('/')}/` : '';
  const expectedPrefix = `/uploads/${prefix}/${idPath}`;
  if (!normalizedPath.startsWith(expectedPrefix)) {
    throw new ForbiddenException(errorMessage);
  }
  validateRelativePath(normalizedPath.slice(expectedPrefix.length), errorMessage);
}
