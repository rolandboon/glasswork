import {
  GetObjectTaggingCommand,
  type GetObjectTaggingCommandInput,
  type GetObjectTaggingCommandOutput,
  type S3Client,
} from '@aws-sdk/client-s3';
import { normalizeS3Key } from './s3-key.js';

const GUARD_DUTY_SCAN_STATUSES = [
  'NO_THREATS_FOUND',
  'THREATS_FOUND',
  'UNSUPPORTED',
  'ACCESS_DENIED',
  'FAILED',
] as const;

export type GuardDutyScanStatus = (typeof GUARD_DUTY_SCAN_STATUSES)[number] | 'pending' | 'unknown';

export interface GuardDutyScanResult {
  /** Native GuardDuty status, or pending/unknown when no recognized result is available. */
  readonly status: GuardDutyScanStatus;
  /** Original S3 response, including the object version and unmodified tags. */
  readonly response: GetObjectTaggingCommandOutput;
}

/** Reads GuardDuty's scan tag without granting access or deciding application policy. */
export class GuardDutyMalwareScanner {
  constructor(private readonly config: { client: S3Client; bucketName: string }) {}

  async getScanResult(
    filePath: string,
    options: Omit<GetObjectTaggingCommandInput, 'Bucket' | 'Key'> = {}
  ): Promise<GuardDutyScanResult> {
    const response = await this.config.client.send(
      new GetObjectTaggingCommand({
        ...options,
        Bucket: this.config.bucketName,
        Key: normalizeS3Key(filePath),
      })
    );
    const value = response.TagSet?.find((tag) => tag.Key === 'GuardDutyMalwareScanStatus')?.Value;
    const status =
      value === undefined
        ? 'pending'
        : (GUARD_DUTY_SCAN_STATUSES.find((candidate) => candidate === value) ?? 'unknown');
    return { status, response };
  }
}
