import { check, pipe, string, transform } from 'valibot';

// ============================================================================
// File Name Validators
// ============================================================================

/**
 * Slugify a filename base for URL-safe paths.
 * Converts to lowercase, removes diacritics, replaces non-alphanumeric with hyphens, trims hyphens.
 */
function slugify(baseName: string): string {
  return baseName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * File name validation with extension check AND sanitization.
 * Validates that the file has an allowed extension, then transforms it to a URL-safe slug.
 *
 * @param allowedExtensions - Extensions to allow (e.g., ['.jpg', '.png', '.pdf'])
 * @param errorMessage - Custom error message for invalid file type
 * @returns Valibot schema that validates and sanitizes the filename
 *
 * @example
 * ```typescript
 * // Define allowed extensions per use case
 * const ALLOWED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'] as const;
 * const ALLOWED_DOCUMENT_EXTENSIONS = ['.pdf', '.docx'] as const;
 *
 * // Use in schema
 * const GetUploadUrlQuery = v.object({
 *   name: sanitizedFileName(ALLOWED_IMAGE_EXTENSIONS),
 * });
 *
 * // Input: "My Photo (1).PNG" → Output: "my-photo-1.png"
 * // Input: "test.txt" → ValidationError (extension not allowed)
 * ```
 */
export const sanitizedFileName = (allowedExtensions: readonly string[], errorMessage?: string) =>
  pipe(
    string(),
    check(
      (input) => {
        const lastDotIndex = input.lastIndexOf('.');
        if (lastDotIndex === -1 || lastDotIndex === input.length - 1) {
          return false;
        }
        // Check for double extensions like .tar.gz
        const parts = input.toLowerCase().split('.');
        const ext1 = `.${parts[parts.length - 1]}`;
        const ext2 =
          parts.length > 2 ? `.${parts[parts.length - 2]}.${parts[parts.length - 1]}` : null;

        return !!(allowedExtensions.includes(ext1) || (ext2 && allowedExtensions.includes(ext2)));
      },
      errorMessage ?? `Invalid file type. Allowed: ${allowedExtensions.join(', ')}`
    ),
    transform((input): string => {
      const parts = input.split('.');

      // Determine which extension to use based on allowed list
      let extension = parts[parts.length - 1].toLowerCase();
      let baseName = parts.slice(0, parts.length - 1).join('.');

      if (parts.length > 2) {
        const doubleExt = `.${parts[parts.length - 2]}.${parts[parts.length - 1]}`.toLowerCase();
        if (allowedExtensions.includes(doubleExt)) {
          extension = parts
            .slice(parts.length - 2)
            .join('.')
            .toLowerCase();
          baseName = parts.slice(0, parts.length - 2).join('.');
        }
      }

      const slugifiedName = slugify(baseName);
      return slugifiedName ? `${slugifiedName}.${extension}` : `file.${extension}`;
    })
  );

/**
 * File name validation with extension check (no transformation).
 * Use when you want to validate the extension but keep the original filename.
 *
 * @param allowedExtensions - Extensions to allow (e.g., ['.jpg', '.png'])
 * @param errorMessage - Custom error message for invalid file type
 * @returns Valibot schema that validates the filename extension
 *
 * @example
 * ```typescript
 * const schema = v.object({
 *   name: fileNameWithExtension(['.pdf', '.docx']),
 * });
 * ```
 */
export const fileNameWithExtension = (
  allowedExtensions: readonly string[],
  errorMessage?: string
) =>
  pipe(
    string(),
    check(
      (input) => {
        const lastDotIndex = input.lastIndexOf('.');
        if (lastDotIndex === -1 || lastDotIndex === input.length - 1) {
          return false;
        }
        const lowerInput = input.toLowerCase();
        const parts = lowerInput.split('.');
        const ext1 = `.${parts[parts.length - 1]}`;
        const ext2 =
          parts.length > 2 ? `.${parts[parts.length - 2]}.${parts[parts.length - 1]}` : null;

        return !!(allowedExtensions.includes(ext1) || (ext2 && allowedExtensions.includes(ext2)));
      },
      errorMessage ?? `Invalid file type. Allowed: ${allowedExtensions.join(', ')}`
    )
  );
