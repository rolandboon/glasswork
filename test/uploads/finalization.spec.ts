import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import { UploadsService } from '../../src/uploads/uploads.service.js';

describe('upload finalization', () => {
  it('inspects native metadata and copies the inspected ETag before deleting the source', async () => {
    const client = new S3Client({ region: 'eu-west-1' });
    const send = vi.spyOn(client, 'send').mockResolvedValue({ ETag: 'version', ContentLength: 42 });
    const service = new UploadsService({ region: 'eu-west-1', bucketName: 'files', client });
    expect(service.client).toBe(client);
    expect(await service.inspectFile('/staging/a b.pdf')).toMatchObject({ ETag: 'version' });
    await service.finalizeUpload('/staging/a b.pdf', '/final/a.pdf', 'version');
    expect(send.mock.calls.map(([command]) => command.constructor)).toEqual([
      HeadObjectCommand,
      CopyObjectCommand,
      DeleteObjectCommand,
    ]);
    expect(send.mock.calls[1]?.[0].input).toMatchObject({
      CopySource: 'files/staging/a%20b.pdf',
      CopySourceIfMatch: 'version',
      Key: 'final/a.pdf',
    });
  });

  it('preserves AWS precondition errors and the source when its version changed', async () => {
    const client = new S3Client({ region: 'eu-west-1' });
    const error = new Error('PreconditionFailed');
    const send = vi.spyOn(client, 'send').mockRejectedValue(error);
    const service = new UploadsService({ region: 'eu-west-1', bucketName: 'files', client });
    await expect(service.finalizeUpload('staging/a', 'final/a', 'old-version')).rejects.toBe(error);
    expect(send).toHaveBeenCalledOnce();
    await expect(service.finalizeUpload('same', 'same', 'version')).rejects.toThrow(
      'distinct destination'
    );
    expect(send).toHaveBeenCalledOnce();
    await expect(
      service.finalizeUpload('staging/a', 'final/a', 'etag', {
        sourceVersionId: '',
      })
    ).rejects.toThrow('cannot be empty');
    expect(send).toHaveBeenCalledOnce();
  });

  it('copies only the inspected version and retains quarantine when requested', async () => {
    const client = new S3Client({ region: 'eu-west-1' });
    const result = { $metadata: {}, VersionId: 'published-version' };
    const send = vi
      .spyOn(client, 'send')
      .mockResolvedValueOnce({ $metadata: {}, ETag: 'etag', VersionId: 'scan+version' })
      .mockResolvedValueOnce(result);
    const service = new UploadsService({ region: 'eu-west-1', bucketName: 'files', client });
    await service.inspectFile('/staging/a b.pdf', { VersionId: 'scan+version' });
    expect(
      await service.finalizeUpload('/staging/a b.pdf', '/final/a.pdf', 'etag', {
        sourceVersionId: 'scan+version',
        deleteSource: false,
        command: { TaggingDirective: 'REPLACE', Tagging: '' },
      })
    ).toBe(result);
    expect(send.mock.calls.map(([command]) => command.constructor)).toEqual([
      HeadObjectCommand,
      CopyObjectCommand,
    ]);
    expect(send.mock.calls[0]?.[0].input).toMatchObject({ VersionId: 'scan+version' });
    expect(send.mock.calls[1]?.[0].input).toMatchObject({
      CopySource: 'files/staging/a%20b.pdf?versionId=scan%2Bversion',
      CopySourceIfMatch: 'etag',
      TaggingDirective: 'REPLACE',
      Tagging: '',
    });
  });

  it('deletes the copied source version without deleting a newer current version', async () => {
    const client = new S3Client({ region: 'eu-west-1' });
    const send = vi.spyOn(client, 'send').mockResolvedValue({ $metadata: {} });
    const service = new UploadsService({ region: 'eu-west-1', bucketName: 'files', client });
    await service.finalizeUpload('staging/a', 'final/a', 'etag', {
      sourceVersionId: 'checked-version',
    });
    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(DeleteObjectCommand);
    expect(send.mock.calls[1]?.[0].input).toMatchObject({
      Bucket: 'files',
      Key: 'staging/a',
      VersionId: 'checked-version',
    });
  });

  it('preserves native cleanup failures after a successful copy', async () => {
    const client = new S3Client({ region: 'eu-west-1' });
    const error = new Error('AccessDenied');
    const send = vi
      .spyOn(client, 'send')
      .mockResolvedValueOnce({ $metadata: {}, VersionId: 'published-version' })
      .mockRejectedValueOnce(error);
    const service = new UploadsService({ region: 'eu-west-1', bucketName: 'files', client });
    await expect(service.finalizeUpload('staging/a', 'final/a', 'etag')).rejects.toBe(error);
    expect(send.mock.calls.map(([command]) => command.constructor)).toEqual([
      CopyObjectCommand,
      DeleteObjectCommand,
    ]);
  });
});
