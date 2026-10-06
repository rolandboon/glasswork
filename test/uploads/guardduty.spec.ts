import { GetObjectTaggingCommand, S3Client } from '@aws-sdk/client-s3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GuardDutyMalwareScanner } from '../../src/uploads/guardduty.js';

afterEach(() => vi.restoreAllMocks());

describe('GuardDuty scan results', () => {
  it.each(['NO_THREATS_FOUND', 'THREATS_FOUND', 'UNSUPPORTED', 'ACCESS_DENIED', 'FAILED'])(
    'preserves the provider status and response for %s',
    async (status) => {
      const client = new S3Client({ region: 'eu-west-1' });
      const response = {
        $metadata: { requestId: 'request' },
        VersionId: 'scanned-version',
        TagSet: [{ Key: 'GuardDutyMalwareScanStatus', Value: status }],
      };
      const send = vi.spyOn(client, 'send').mockResolvedValue(response);
      const scanner = new GuardDutyMalwareScanner({ client, bucketName: 'files' });
      const result = await scanner.getScanResult('/staging//file', {
        VersionId: 'scanned-version',
      });
      expect(result.status).toBe(status);
      expect(result.response).toBe(response);
      expect(send).toHaveBeenCalledExactlyOnceWith(expect.any(GetObjectTaggingCommand));
      expect(send.mock.calls[0]?.[0].input).toEqual({
        Bucket: 'files',
        Key: 'staging/file',
        VersionId: 'scanned-version',
      });
    }
  );

  it.each([
    { tags: undefined, expected: 'pending' },
    { tags: [], expected: 'pending' },
    { tags: [{ Key: 'unrelated', Value: 'NO_THREATS_FOUND' }], expected: 'pending' },
    { tags: [{ Key: 'GuardDutyMalwareScanStatus', Value: '' }], expected: 'unknown' },
    { tags: [{ Key: 'GuardDutyMalwareScanStatus', Value: 'FUTURE_STATUS' }], expected: 'unknown' },
  ])(
    'does not approve missing or unrecognized scan results: $expected',
    async ({ tags, expected }) => {
      const client = new S3Client({ region: 'eu-west-1' });
      const response = { $metadata: {}, TagSet: tags };
      vi.spyOn(client, 'send').mockResolvedValue(response);
      const result = await new GuardDutyMalwareScanner({
        client,
        bucketName: 'files',
      }).getScanResult('file');
      expect(result).toEqual({ status: expected, response });
    }
  );

  it('preserves native AWS failures without treating them as scan approval', async () => {
    const client = new S3Client({ region: 'eu-west-1' });
    const error = new Error('AccessDenied');
    vi.spyOn(client, 'send').mockRejectedValue(error);
    const scanner = new GuardDutyMalwareScanner({ client, bucketName: 'files' });
    await expect(scanner.getScanResult('file')).rejects.toBe(error);
  });
});
