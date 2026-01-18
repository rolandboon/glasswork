import type { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { NotFoundException } from '../http/errors.js';

// ============================================================================
// Type Definitions
// ============================================================================

export interface UploadFileConfig {
  /** Directory path for the file (e.g., 'uploads/avatars/user123/abc123') */
  readonly dir: string;
  /** Sanitized file name (e.g., 'photo.jpg') */
  readonly fileName: string;
}

export interface SignedUrlResponse {
  /** Presigned URL for uploading the file */
  readonly uploadUrl: string;
  /** Relative path where the file will be stored (e.g., '/uploads/avatars/...') */
  readonly path: string;
  /** Expiration timestamp of the presigned URL */
  readonly expiresAt: Date;
}

export interface SignedDownloadUrlResponse {
  /** Presigned URL for downloading the file */
  readonly downloadUrl: string;
  /** Expiration timestamp of the presigned URL */
  readonly expiresAt: Date;
}

export interface StreamFileResult {
  /** Readable stream of the file contents */
  readonly body: Readable;
  /** MIME type of the file */
  readonly contentType: string | undefined;
  /** Size of the file in bytes */
  readonly contentLength: number | undefined;
}

export interface UploadsServiceConfig {
  /** AWS region (e.g., 'eu-west-1') */
  readonly region: string;
  /** S3 bucket name */
  readonly bucketName: string;
  /** Presigned URL expiration in seconds (default: 3600) */
  readonly urlExpiration?: number;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_URL_EXPIRATION = 3600; // 1 hour
const MILLISECONDS_PER_SECOND = 1000;

// ============================================================================
// Service
// ============================================================================

/**
 * Service for S3 file operations including presigned URL generation and streaming.
 * Framework-agnostic - can be used anywhere TypeScript runs.
 *
 * @example
 * ```typescript
 * const uploadsService = new UploadsService({
 *   region: 'eu-west-1',
 *   bucketName: 'my-files-bucket',
 *   urlExpiration: 3600,
 * });
 *
 * // Generate presigned upload URL
 * const { uploadUrl, path } = await uploadsService.getSignedUploadUrl({
 *   dir: 'uploads/avatars/user123',
 *   fileName: 'photo.jpg',
 * });
 *
 * // Stream file for private access
 * const { body, contentType } = await uploadsService.streamFile('/uploads/docs/file.pdf');
 *
 * // Generate presigned download URL for private files
 * const { downloadUrl } = await uploadsService.getSignedDownloadUrl('/uploads/docs/private.pdf');
 * ```
 */
export class UploadsService {
  private readonly client: S3Client;
  private readonly bucketName: string;
  private readonly urlExpiration: number;

  constructor(config: UploadsServiceConfig) {
    this.client = new S3Client({ region: config.region });
    this.bucketName = config.bucketName;
    this.urlExpiration = config.urlExpiration ?? DEFAULT_URL_EXPIRATION;
  }

  /**
   * Generate a presigned URL for uploading a file to S3.
   * The URL allows direct upload from the client without going through Lambda.
   */
  async getSignedUploadUrl(fileConfig: UploadFileConfig): Promise<SignedUrlResponse> {
    const filePath = `${fileConfig.dir}/${fileConfig.fileName}`;
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: filePath,
    });
    const url = await getSignedUrl(this.client, command, {
      expiresIn: this.urlExpiration,
    });
    return {
      uploadUrl: url,
      path: `/${filePath}`,
      expiresAt: new Date(Date.now() + this.urlExpiration * MILLISECONDS_PER_SECOND),
    };
  }

  /**
   * Stream a file from S3 for private file access.
   * Returns a readable stream that can be piped to the HTTP response.
   *
   * **Note**: Lambda has a 6MB response payload limit for synchronous invocations.
   * For larger files, consider using presigned GET URLs with short expiration.
   */
  async streamFile(filePath: string): Promise<StreamFileResult> {
    try {
      const key = this.normalizeKey(filePath);
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });
      const response = await this.client.send(command);
      const body = response.Body as Readable;
      return {
        body,
        contentType: response.ContentType,
        contentLength: response.ContentLength,
      };
    } catch (error) {
      if (error instanceof S3ServiceException && error.name === 'NoSuchKey') {
        throw new NotFoundException('File not found');
      }
      throw error;
    }
  }

  /**
   * Generate a presigned URL for downloading a file from S3.
   * Use this instead of streaming for files that may exceed Lambda's 6MB response limit.
   *
   * @param filePath - Relative path to the file (e.g., '/uploads/docs/file.pdf')
   * @param expiresIn - Optional expiration in seconds (default: service urlExpiration)
   */
  async getSignedDownloadUrl(
    filePath: string,
    expiresIn?: number
  ): Promise<SignedDownloadUrlResponse> {
    const key = this.normalizeKey(filePath);
    const expiration = expiresIn ?? this.urlExpiration;
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });
    const url = await getSignedUrl(this.client, command, {
      expiresIn: expiration,
    });
    return {
      downloadUrl: url,
      expiresAt: new Date(Date.now() + expiration * MILLISECONDS_PER_SECOND),
    };
  }

  /**
   * Delete a file from S3 by path.
   */
  async deleteFile(filePath: string): Promise<void> {
    const key = this.normalizeKey(filePath);
    const command = new DeleteObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });
    await this.client.send(command);
  }

  /**
   * Normalize file path to S3 key format (strip leading slashes).
   */
  private normalizeKey(filePath: string): string {
    return filePath.replace(/^\/+/, '').replace(/\/+/g, '/');
  }
}
