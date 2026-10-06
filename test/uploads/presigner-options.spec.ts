import { S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { UploadsService } from '../../src/uploads/uploads.service.js';

describe('upload signing options', () => {
  it('binds size, content type and create-only headers with the native signer', async () => {
    const client = new S3Client({
      region: 'eu-west-1',
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
    const service = new UploadsService({ region: 'eu-west-1', bucketName: 'files', client });
    const result = await service.getSignedUploadUrl(
      { dir: 'staging', fileName: 'a b.pdf' },
      {
        expiresIn: 300,
        command: { ContentLength: 42, ContentType: 'application/pdf', IfNoneMatch: '*' },
        presigner: {
          signingDate: new Date('2026-10-06T12:00:00Z'),
          signableHeaders: new Set(['content-length', 'content-type', 'if-none-match']),
        },
      }
    );
    const url = new URL(result.uploadUrl);
    expect(url.pathname).toBe('/staging/a%20b.pdf');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe(
      'content-length;content-type;host;if-none-match'
    );
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('X-Amz-Date')).toBe('20261006T120000Z');
    expect(url.searchParams.has('x-amz-checksum-crc32')).toBe(false);
    const changed = await service.getSignedUploadUrl(
      { dir: 'staging', fileName: 'a b.pdf' },
      {
        expiresIn: 300,
        command: { ContentLength: 43, ContentType: 'application/pdf', IfNoneMatch: '*' },
        presigner: {
          signingDate: new Date('2026-10-06T12:00:00Z'),
          signableHeaders: new Set(['content-length', 'content-type', 'if-none-match']),
        },
      }
    );
    expect(new URL(changed.uploadUrl).searchParams.get('X-Amz-Signature')).not.toBe(
      url.searchParams.get('X-Amz-Signature')
    );
  });
});
