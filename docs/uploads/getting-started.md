# Uploads Module - Getting Started

Glasswork's uploads module provides secure S3 presigned URL file uploads optimized for serverless environments. Files are uploaded directly from the frontend to S3, bypassing Lambda body size limits.

After reading this guide, you will know:

- How to configure the uploads service with AWS S3
- How to create secure upload paths with random IDs
- How to validate file names and extensions
- How to type responses and stream handlers correctly
- How to serve private files via presigned download URLs

## Quick Start

### 1. Install Dependencies

:::: code-group

```bash [npm]
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

```bash [pnpm]
pnpm add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

::::

### 2. Create the Uploads Module

```typescript
// src/modules/uploads/uploads.module.ts
import { defineModule, UploadsService } from 'glasswork';
import { uploadsRoutes } from './uploads.routes';

export const UploadsModule = defineModule({
  name: 'uploads',
  providers: [
    {
      provide: 'uploadsService',
      useFactory: ({ config }) => new UploadsService({
        region: config.get('awsRegion'),
        bucketName: config.get('s3FilesBucket'),
        urlExpiration: config.get('s3UrlExpiration'),
      }),
    },
  ],
  routes: uploadsRoutes,
  exports: ['uploadsService'],
});
```

### 3. Create Upload Routes

```typescript
// src/modules/uploads/uploads.routes.ts
import {
  createRoutes,
  sanitizedFileName,
  createUploadConfig,
  assertUploadPathOwnership,
} from 'glasswork';
import * as v from 'valibot';

// Define allowed extensions for your app
const ALLOWED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'] as const;

// ============================================================================
// Request DTOs
// ============================================================================

const GetUploadUrlQueryDto = v.object({
  name: sanitizedFileName(ALLOWED_IMAGE_EXTENSIONS),
});

// ============================================================================
// Response DTOs
// ============================================================================

const UploadUrlResponseDto = v.object({
  uploadUrl: v.string(),
  path: v.string(),
  expiresAt: v.string(),
});

export const uploadsRoutes = createRoutes((router, { uploadsService }, route) => {
  // Get presigned URL for upload
  router.get('/api/me/avatar-upload-url', ...route({
    summary: 'Get presigned URL for avatar upload',
    query: GetUploadUrlQueryDto,
    responses: { 200: UploadUrlResponseDto },
    handler: async ({ query, user }) => {
      const config = createUploadConfig('avatars', [user.id], query.name);
      const result = await uploadsService.getSignedUploadUrl(config);
      return {
        uploadUrl: result.uploadUrl,
        path: result.path,
        expiresAt: result.expiresAt.toISOString(),
      };
    },
  }));

  // Delete uploaded file
  router.delete('/api/me/avatar', ...route({
    summary: 'Delete avatar',
    query: v.object({ path: v.string() }),
    responses: { 204: v.null_() },
    handler: async ({ query, user }) => {
      assertUploadPathOwnership(query.path, 'avatars', [user.id]);
      await uploadsService.deleteFile(query.path);
      return null;
    },
  }));
});
```

## File Name Validation

Use `sanitizedFileName` to validate extensions and create URL-safe filenames:

```typescript
import { sanitizedFileName } from 'glasswork';

// Define allowed extensions per use case
const ALLOWED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'] as const;
const ALLOWED_DOCUMENT_EXTENSIONS = ['.pdf', '.docx'] as const;

// Create validators
const imageNameSchema = sanitizedFileName(ALLOWED_IMAGE_EXTENSIONS);
const documentNameSchema = sanitizedFileName(ALLOWED_DOCUMENT_EXTENSIONS);

// Input: "My Photo (1).PNG" → Output: "my-photo-1.png"
```

If you want to validate without sanitizing, use `fileNameWithExtension`:

```typescript
import { fileNameWithExtension } from 'glasswork';

const schema = fileNameWithExtension(['.pdf', '.docx']);
// Validates extension but keeps original filename
```

## Upload Path Security

### Path Structure

Files are stored with this structure:

```
/uploads/{prefix}/{ids...}/{randomId}/{filename}
```

- **prefix**: Category like `avatars`, `documents`, `logos`
- **ids**: Ownership identifiers like `[userId]` or `[orgId, projectId]`
- **randomId**: 16-char hex string prevents overwriting
- **filename**: Sanitized filename

### Ownership Validation

Use `assertUploadPathOwnership` before delete operations:

```typescript
import { assertUploadPathOwnership } from 'glasswork';

// In delete handler - throws ForbiddenException if path doesn't match
assertUploadPathOwnership(
  query.path,        // Path from request
  'avatars',         // Expected prefix
  [user.id]          // Expected IDs
);
```

This prevents:
- Path traversal attacks (`../admin/file.txt`)
- Accessing other users' files
- URL-encoded attacks (`%2e%2e`)

## File Access Methods

Glasswork supports three methods for serving files, each with different security and performance characteristics:

| Method | Authentication | File Size | Use Case |
|--------|---------------|-----------|----------|
| **CDN (CloudFront)** | None | Unlimited | Public assets, profile images |
| **Presigned URLs** | At URL generation | Unlimited | Private files, large downloads |
| **Backend Streaming** | Per-request | < 6MB | Strictly authenticated small files |

### Method 1: CDN Access (Public Files)

Files served directly through CloudFront provide the best performance but minimal security. The URL includes a unique random segment that's hard to guess, but anyone with the URL can access the file.

**Best for:** Profile pictures, organization logos, public attachments

```typescript
// Store the path, construct CDN URL on frontend
const cdnUrl = `${import.meta.env.VITE_CDN_URL}${user.imagePath}`;
// https://cdn.example.com/uploads/avatars/user123/a1b2c3d4/photo.jpg
```

| Pros | Cons |
|------|------|
| ✅ Fastest delivery (edge cached) | ❌ No access control after upload |
| ✅ No Lambda invocation | ❌ URL can be shared by anyone |
| ✅ Unlimited file size | ❌ Requires CloudFront + S3 setup |

### Method 2: Presigned Download URLs (Private Files)

Generate temporary S3 URLs that expire after a configurable period. Authentication happens when requesting the URL, not when downloading.

**Best for:** Private documents, file exports, large media files

```typescript
const DownloadUrlResponseDto = v.object({
  downloadUrl: v.string(),
  expiresAt: v.string(),
});

router.get('/api/documents/:id/download-url', ...route({
  params: v.object({ id: v.string() }),
  responses: { 200: DownloadUrlResponseDto },
  handler: async ({ params, user }) => {
    const doc = await documentService.getById(params.id);

    if (doc.ownerId !== user.id) {
      throw new ForbiddenException('Access denied');
    }

    // Generate presigned GET URL (default: 1 hour expiration)
    const result = await uploadsService.getSignedDownloadUrl(doc.filePath);

    // Or with short expiration (5 minutes) for sensitive files
    // const result = await uploadsService.getSignedDownloadUrl(doc.filePath, 300);

    return {
      downloadUrl: result.downloadUrl,
      expiresAt: result.expiresAt.toISOString(),
    };
  },
}));
```

| Pros | Cons |
|------|------|
| ✅ Works for any file size | ⚠️ URL can be shared during expiry |
| ✅ Fast (direct S3 download) | ⚠️ Auth only at URL generation |
| ✅ No Lambda payload limits | ❌ Extra API call to get URL |

> [!TIP]
> Use short expiration times (60-300 seconds) for sensitive files. The client requests the URL just before downloading.

### Method 3: Backend Streaming (Strictly Authenticated)

Stream files through Lambda for real-time authentication on every request. The user's session is validated before any file data is sent.

**Best for:** Highly sensitive files requiring strict access control

```typescript
router.get('/api/documents/:id/content', ...route({
  params: v.object({ id: v.string() }),
  // Note: No responses key when returning raw Response
  handler: async ({ params, user, context }): Promise<Response> => {
    const doc = await documentService.getById(params.id);

    if (doc.ownerId !== user.id) {
      throw new ForbiddenException('Access denied');
    }

    const { body, contentType, contentLength } =
      await uploadsService.streamFile(doc.filePath);

    // Return raw Response - bypasses Glasswork's response handling
    return new Response(body as unknown as ReadableStream, {
      headers: {
        'Content-Type': contentType ?? 'application/octet-stream',
        'Content-Length': String(contentLength ?? 0),
        'Content-Disposition': `attachment; filename="${doc.fileName}"`,
      },
    });
  },
}));
```

| Pros | Cons |
|------|------|
| ✅ Auth on every request | ❌ **6MB limit** (Lambda payload) |
| ✅ Cannot share URL | ❌ Slower (Lambda + S3 roundtrip) |
| ✅ Audit logging possible | ❌ Higher Lambda costs |

> [!WARNING]
> Lambda has a 6MB response payload limit for synchronous invocations. For files that may exceed this, use presigned download URLs instead.

## Environment Variables

```env
# Required
AWS_REGION=eu-west-1
S3_FILES_BUCKET=my-app-files

# Optional
S3_URL_EXPIRATION=3600  # Presigned URL expiration in seconds (default: 3600)
```

## API Reference

### UploadsService

| Method | Description |
|--------|-------------|
| `getSignedUploadUrl(config)` | Generate presigned PUT URL for uploads |
| `getSignedDownloadUrl(path, expiresIn?)` | Generate presigned GET URL for downloads |
| `streamFile(path)` | Stream file through Lambda (< 6MB) |
| `deleteFile(path)` | Delete file from S3 |

### Utilities

| Function | Description |
|----------|-------------|
| `createUploadConfig(prefix, ids, filename)` | Generate secure upload path |
| `assertUploadPathOwnership(path, prefix, ids)` | Validate file ownership |
| `sanitizedFileName(extensions)` | Valibot schema for sanitized filenames |
| `fileNameWithExtension(extensions)` | Valibot schema for filename validation |

## Testing

Create a mock `UploadsService` for testing:

```typescript
import { vi } from 'vitest';

const mockUploadsService = {
  getSignedUploadUrl: vi.fn().mockResolvedValue({
    uploadUrl: 'https://bucket.s3.amazonaws.com/presigned',
    path: '/uploads/avatars/user123/abc123/photo.jpg',
    expiresAt: new Date('2026-01-20'),
  }),
  getSignedDownloadUrl: vi.fn().mockResolvedValue({
    downloadUrl: 'https://bucket.s3.amazonaws.com/presigned-get',
    expiresAt: new Date('2026-01-20'),
  }),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  streamFile: vi.fn().mockResolvedValue({
    body: new ReadableStream(),
    contentType: 'application/pdf',
    contentLength: 12345,
  }),
};
```
