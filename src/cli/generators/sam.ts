import { stringify } from 'yaml';
import type { ResolvedGlassworkCliConfig } from '../config.js';

export function generateSamTemplate(config: ResolvedGlassworkCliConfig): string {
  const resources: Record<string, unknown> = {
    ...createApiFunction(config),
    ...createQueues(config),
    ...createTables(config),
    ...createStaticSite(config),
    ...createCdn(config),
  };

  const template = {
    AWSTemplateFormatVersion: '2010-09-09',
    Transform: 'AWS::Serverless-2016-10-31',
    Description: `Glasswork deployment for ${config.name || 'application'}`,
    Resources: resources,
    Outputs: {
      ApiFunctionName: { Value: { Ref: 'ApiFunction' } },
      ...(config.infrastructure?.api?.type === 'function-url'
        ? { ApiUrl: { Value: { 'Fn::GetAtt': ['ApiFunction', 'FunctionUrl'] } } }
        : {}),
    },
  };

  return stringify(template);
}

function createApiFunction(config: ResolvedGlassworkCliConfig) {
  const handlerBase = stripExtension(config.build.outFile);

  const functionResource = {
    ApiFunction: {
      Type: 'AWS::Serverless::Function',
      Properties: {
        CodeUri: config.build.outDir,
        Handler: `${handlerBase}.handler`,
        Runtime: config.lambda.runtime,
        Architectures: [config.lambda.architecture],
        MemorySize: config.lambda.memory,
        Timeout: config.lambda.timeout,
        Environment: { Variables: config.lambda.environment },
        ...(config.infrastructure?.api?.type === 'function-url'
          ? {
              FunctionUrlConfig: {
                AuthType: 'NONE',
                Cors: config.infrastructure.api?.cors ? { AllowOrigins: ['*'] } : undefined,
              },
            }
          : {}),
        ...(config.infrastructure?.api?.type === 'api-gateway'
          ? {
              Events: {
                Api: {
                  Type: 'HttpApi',
                  Properties: {
                    Path: '/{proxy+}',
                    Method: 'ANY',
                  },
                },
              },
            }
          : {}),
      },
    },
  };

  return functionResource;
}

function createQueues(config: ResolvedGlassworkCliConfig) {
  const queues = config.infrastructure?.queues;
  if (!queues || Object.keys(queues).length === 0) return {};

  const resources: Record<string, unknown> = {};
  for (const [name, details] of Object.entries(queues)) {
    const pascal = toPascalCase(name);
    resources[`${pascal}Queue`] = {
      Type: 'AWS::SQS::Queue',
      Properties: {
        QueueName: `\${AWS::StackName}-${name}`,
        VisibilityTimeout: details.visibilityTimeout ?? 300,
        RedrivePolicy: {
          deadLetterTargetArn: { 'Fn::GetAtt': [`${pascal}DLQ`, 'Arn'] },
          maxReceiveCount: 3,
        },
      },
    };

    resources[`${pascal}DLQ`] = {
      Type: 'AWS::SQS::Queue',
      Properties: {
        QueueName: `\${AWS::StackName}-${name}-dlq`,
        MessageRetentionPeriod: 1209600,
      },
    };
  }

  return resources;
}

function createTables(config: ResolvedGlassworkCliConfig) {
  const tables = config.infrastructure?.tables;
  if (!tables || Object.keys(tables).length === 0) return {};

  const resources: Record<string, unknown> = {};

  for (const [name, details] of Object.entries(tables)) {
    const pascal = toPascalCase(name);
    resources[`${pascal}Table`] = {
      Type: 'AWS::DynamoDB::Table',
      Properties: {
        TableName: `\${AWS::StackName}-${name}`,
        BillingMode: details.billingMode || 'PAY_PER_REQUEST',
        AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }],
        KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
        ...(details.ttl
          ? {
              TimeToLiveSpecification: {
                AttributeName: details.ttl,
                Enabled: true,
              },
            }
          : {}),
      },
    };
  }

  return resources;
}

function createStaticSite(config: ResolvedGlassworkCliConfig) {
  const site = config.infrastructure?.staticSite;
  if (!site) return {};

  return {
    StaticSiteBucket: {
      Type: 'AWS::S3::Bucket',
      Properties: {
        // biome-ignore lint/suspicious/noTemplateCurlyInString: CloudFormation substitution string
        BucketName: { 'Fn::Sub': '${AWS::StackName}-static-site' },
        WebsiteConfiguration: {
          IndexDocument: site.indexDocument || 'index.html',
        },
      },
    },
  };
}

function createCdn(config: ResolvedGlassworkCliConfig) {
  const cdn = config.infrastructure?.cdn;
  if (!cdn?.enabled || !config.infrastructure?.staticSite) return {};

  return {
    CloudFrontDistribution: {
      Type: 'AWS::CloudFront::Distribution',
      Properties: {
        DistributionConfig: {
          Enabled: true,
          Origins: [
            {
              DomainName: { 'Fn::GetAtt': ['StaticSiteBucket', 'RegionalDomainName'] },
              Id: 'StaticSite',
              S3OriginConfig: {},
            },
          ],
          DefaultCacheBehavior: {
            TargetOriginId: 'StaticSite',
            ViewerProtocolPolicy: 'redirect-to-https',
          },
          DefaultRootObject: 'index.html',
          Aliases: cdn.domainName ? [cdn.domainName] : undefined,
          ViewerCertificate: cdn.certificateArn
            ? {
                AcmCertificateArn: cdn.certificateArn,
                SslSupportMethod: 'sni-only',
              }
            : undefined,
        },
      },
    },
  };
}

function toPascalCase(value: string): string {
  return value
    .split(/[\s-_]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function stripExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  return lastDot === -1 ? fileName : fileName.slice(0, lastDot);
}
