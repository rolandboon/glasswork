import { beforeEach, describe, expect, it, vi } from 'vitest';

// Create hoisting-safe mocks using vi.hoisted
const mockSend = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const mockGetSignedUrl = vi.hoisted(() =>
  vi.fn().mockResolvedValue('https://bucket.s3.amazonaws.com/signed-url?signature=abc')
);
const mockPutObjectCommand = vi.hoisted(() => vi.fn());
const mockGetObjectCommand = vi.hoisted(() => vi.fn());
const mockDeleteObjectCommand = vi.hoisted(() => vi.fn());

// Mock AWS SDK - this happens at the top level due to hoisting
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class MockS3Client {
    send = mockSend;
  },
  PutObjectCommand: mockPutObjectCommand,
  GetObjectCommand: mockGetObjectCommand,
  DeleteObjectCommand: mockDeleteObjectCommand,
  S3ServiceException: class S3ServiceException extends Error {
    name: string;
    constructor(args: { name: string }) {
      super();
      this.name = args.name;
    }
  },
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mockGetSignedUrl,
}));

// Import after mocks are set up
import { S3ServiceException } from '@aws-sdk/client-s3';
import { NotFoundException } from '../../src/http/errors.js';
import { UploadsService } from '../../src/uploads/uploads.service.js';

describe('UploadsService', () => {
  let service: UploadsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new UploadsService({
      region: 'eu-west-1',
      bucketName: 'test-bucket',
      urlExpiration: 3600,
    });
    // Default mock behavior
    mockGetSignedUrl.mockResolvedValue('https://bucket.s3.amazonaws.com/signed-url?signature=abc');
  });

  describe('constructor', () => {
    it('should create service with provided config', () => {
      expect(service).toBeInstanceOf(UploadsService);
    });

    it('should use default URL expiration when not provided', () => {
      const serviceWithDefaults = new UploadsService({
        region: 'us-east-1',
        bucketName: 'default-bucket',
      });
      expect(serviceWithDefaults).toBeInstanceOf(UploadsService);
    });
  });

  describe('getSignedUploadUrl', () => {
    it('should return signed URL with correct path', async () => {
      const result = await service.getSignedUploadUrl({
        dir: 'uploads/avatars/user123/abc123',
        fileName: 'photo.jpg',
      });

      expect(result.uploadUrl).toBe('https://bucket.s3.amazonaws.com/signed-url?signature=abc');
      expect(result.path).toBe('/uploads/avatars/user123/abc123/photo.jpg');
      expect(result.expiresAt).toBeInstanceOf(Date);
    });

    it('should construct correct file path from dir and fileName', async () => {
      const result = await service.getSignedUploadUrl({
        dir: 'uploads/documents/org1',
        fileName: 'contract.pdf',
      });

      expect(result.path).toBe('/uploads/documents/org1/contract.pdf');
    });

    it('should call PutObjectCommand with correct bucket and key', async () => {
      await service.getSignedUploadUrl({
        dir: 'uploads/test',
        fileName: 'file.txt',
      });

      expect(mockPutObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'uploads/test/file.txt',
      });
    });

    it('should set expiration date based on urlExpiration config', async () => {
      const before = new Date();
      const result = await service.getSignedUploadUrl({
        dir: 'uploads/test',
        fileName: 'file.txt',
      });

      // Expiration should be roughly urlExpiration seconds from now
      const expectedExpiration = new Date(before.getTime() + 3600 * 1000);
      expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(result.expiresAt.getTime()).toBeLessThanOrEqual(expectedExpiration.getTime() + 1000);
    });
  });

  describe('streamFile', () => {
    it('should call S3 GetObject with correct parameters', async () => {
      const mockBody = { pipe: vi.fn() };
      mockSend.mockResolvedValueOnce({
        Body: mockBody,
        ContentType: 'application/pdf',
        ContentLength: 12345,
      });

      const result = await service.streamFile('/uploads/docs/file.pdf');

      expect(result.body).toBe(mockBody);
      expect(result.contentType).toBe('application/pdf');
      expect(result.contentLength).toBe(12345);
    });

    it('should strip leading slash from path', async () => {
      mockSend.mockResolvedValueOnce({
        Body: {},
        ContentType: 'image/png',
        ContentLength: 100,
      });

      await service.streamFile('/uploads/avatars/test.png');

      expect(mockGetObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'uploads/avatars/test.png',
      });
    });

    it('should handle path without leading slash', async () => {
      mockSend.mockResolvedValueOnce({
        Body: {},
      });

      await service.streamFile('uploads/avatars/test.png');

      expect(mockGetObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'uploads/avatars/test.png',
      });
    });

    it('should handle multiple leading slashes', async () => {
      mockSend.mockResolvedValueOnce({
        Body: {},
      });

      await service.streamFile('///uploads/test.jpg');

      expect(mockGetObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'uploads/test.jpg',
      });
    });

    it('should collapse interior double slashes', async () => {
      mockSend.mockResolvedValueOnce({
        Body: {},
      });

      await service.streamFile('/uploads//docs///file.pdf');

      expect(mockGetObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'uploads/docs/file.pdf',
      });
    });

    it('should throw NotFoundException for NoSuchKey error', async () => {
      // @ts-expect-error Mock constructor
      const error = new S3ServiceException({
        name: 'NoSuchKey',
      });
      mockSend.mockRejectedValueOnce(error);

      await expect(service.streamFile('/uploads/missing.txt')).rejects.toThrow(NotFoundException);
    });

    it('should rethrow other S3 errors', async () => {
      const error = new Error('Other error');
      mockSend.mockRejectedValueOnce(error);

      await expect(service.streamFile('/uploads/error.txt')).rejects.toThrow('Other error');
    });
  });

  describe('deleteFile', () => {
    it('should call S3 DeleteObject with correct parameters', async () => {
      mockSend.mockResolvedValueOnce({});

      await service.deleteFile('/uploads/avatars/user123/photo.jpg');

      expect(mockDeleteObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'uploads/avatars/user123/photo.jpg',
      });
    });

    it('should strip leading slash from path', async () => {
      mockSend.mockResolvedValueOnce({});

      await service.deleteFile('/uploads/test.jpg');

      expect(mockDeleteObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'uploads/test.jpg',
      });
    });

    it('should handle path without leading slash', async () => {
      mockSend.mockResolvedValueOnce({});

      await service.deleteFile('uploads/test.jpg');

      expect(mockDeleteObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'uploads/test.jpg',
      });
    });

    it('should collapse interior double slashes', async () => {
      mockSend.mockResolvedValueOnce({});

      await service.deleteFile('/uploads//avatars///user123/photo.jpg');

      expect(mockDeleteObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'uploads/avatars/user123/photo.jpg',
      });
    });
  });

  describe('getSignedDownloadUrl', () => {
    it('should return signed download URL', async () => {
      const result = await service.getSignedDownloadUrl('/uploads/docs/file.pdf');

      expect(result.downloadUrl).toBe('https://bucket.s3.amazonaws.com/signed-url?signature=abc');
      expect(result.expiresAt).toBeInstanceOf(Date);
    });

    it('should call GetObjectCommand with correct parameters', async () => {
      await service.getSignedDownloadUrl('/uploads/docs/file.pdf');

      expect(mockGetObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'uploads/docs/file.pdf',
      });
    });

    it('should use custom expiration when provided', async () => {
      const customExpiration = 600; // 10 minutes
      const before = Date.now();
      const result = await service.getSignedDownloadUrl('/uploads/test.pdf', customExpiration);

      const expectedMaxExpiration = before + (customExpiration + 1) * 1000;
      expect(result.expiresAt.getTime()).toBeLessThanOrEqual(expectedMaxExpiration);
    });

    it('should strip leading slash from path', async () => {
      await service.getSignedDownloadUrl('/uploads/test.pdf');

      expect(mockGetObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'uploads/test.pdf',
      });
    });
  });
});
